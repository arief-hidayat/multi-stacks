import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as secrets_manager from 'aws-cdk-lib/aws-secretsmanager';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';

interface EcsFargateSvcStackProps extends cdk.StackProps {
  vpcName: string,
  dbPrimaryEndpoint: string,
  dbReaderEndpoint: string,
  dbCredsSecretArn: string,
  dbSecurityGroupId: string,
  cntrVpceSgId: string,
  extListenerArn: string,
  extElbSgId: string,
}

export class EcsFargateSvcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EcsFargateSvcStackProps) {
    super(scope, id, props);
    // Use same vpc from 'vpc' stack
    const vpc = ec2.Vpc.fromLookup(this, 'vpc', {vpcName: props.vpcName});

    // create ECS cluster for the apps (i.e. REST APIs)
    const restApisCluster = new ecs.Cluster(this, 'rest-apis', {
      vpc: vpc,
      enableFargateCapacityProviders: true,
      containerInsights: true,
    });

    // create Task Definition to run on Fargate. 
    const ecsExecutionRole = this.createEcsExecutionRole()
    const ginGormApiTaskDef = new ecs.FargateTaskDefinition(this, 'gin-gorm-api-taskdef', {
      family: 'gin-gorm-api',
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.X86_64
      },
      executionRole: ecsExecutionRole,
    });

    // Define the container spec within Task Definition.
    // image is pulled from ECR repository. Assumed you have CI/CD pipeline setup separately.
    const ginGormApiRrepository = ecr.Repository.fromRepositoryName(this, 'gin-gorm-rest-api-repo', 'ariefhidayat/gin-gorm-api')
    // db credentials is retrieved from secret in Secrets Manager. This was set up from 'pgdb' stack.
    const dbCredsSecret = secrets_manager.Secret.fromSecretAttributes(this, 'db-creds', {secretCompleteArn: props.dbCredsSecretArn})
    // configurations are application specific, e.g. environment variables, port mapping, etc.
    const ginGormApiCntr = ginGormApiTaskDef.addContainer('gin-gorm-rest-api', {
      containerName: 'api',
      image: ecs.ContainerImage.fromEcrRepository(ginGormApiRrepository, "0.0.2"),
      environment: {
        APP_PORT: '80',
        GRACEFUL_SHUTDOWN_PERIOD_SECONDS: '10s',
        DB_WRITER_ENDPOINT: props.dbPrimaryEndpoint,
        DB_READER_ENDPOINT: props.dbReaderEndpoint,
      },
      secrets: {
        DB_USER: ecs.Secret.fromSecretsManager(dbCredsSecret, 'username'),
        DB_PWD: ecs.Secret.fromSecretsManager(dbCredsSecret, 'password'),
        DB_NAME: ecs.Secret.fromSecretsManager(dbCredsSecret, 'dbname'),
      },
      stopTimeout: cdk.Duration.seconds(30),
      portMappings: [
        {
          name: 'http',
          containerPort: 80,
          protocol: ecs.Protocol.TCP,
        }
      ],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'gin-gorm-api-v1',
        logRetention: logs.RetentionDays.THREE_DAYS
      }),
    });


    const dbSG = ec2.SecurityGroup.fromSecurityGroupId(this, 'DBSG', props.dbSecurityGroupId);
    const extLbSG = ec2.SecurityGroup.fromSecurityGroupId(this, 'LBSG', props.extElbSgId);
    const appSG = this.prepareAppSecurityGroup(vpc, extLbSG, dbSG)

    // create ECS Service in the cluster with above Task definition.
    const ginGormApiSvc = new ecs.FargateService(this, 'gin-gorm-api-svc', {
      cluster: restApisCluster,
      taskDefinition: ginGormApiTaskDef,
      desiredCount: 2,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [appSG],
      capacityProviderStrategies: [{
        capacityProvider: "FARGATE",
        base: 0,
        weight: 1
      }]
    });

    const albListener = elbv2.ApplicationListener.fromApplicationListenerAttributes(this, 'alb-listener', {
      listenerArn: props.extListenerArn, securityGroup: extLbSG 
    })
    // create ALB Target Group targeting above ECS service.
    const ginGormApiV1 = new elbv2.ApplicationTargetGroup(this, 'gin-gorm-api-v1-tg', {
      vpc: vpc,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [ginGormApiSvc],
      deregistrationDelay: cdk.Duration.seconds(60),
      // define proper health check based on your apps
      healthCheck: {
        path: "/healthz",
        interval: cdk.Duration.seconds(15),
        timeout: cdk.Duration.seconds(3),
        healthyThresholdCount: 5,
        unhealthyThresholdCount: 2,
      },
    })
    // add target group. you might want to specify any conditions and priority.
    albListener.addTargetGroups('rest-v1-tg', {
      targetGroups: [ginGormApiV1],
      priority: 1,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(["/api/v1/*"]),
        elbv2.ListenerCondition.hostHeaders(["ecs-fargate.demo.ariefh.site"])
      ]
    })
  }

  // IAM role to allow putting logs into CloudWatch and access ECR.
  createEcsExecutionRole(): iam.Role {
    const taskExecutionRole = new iam.Role(this, `ecs-execution-role`, {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    taskExecutionRole.addToPolicy(
      new iam.PolicyStatement({
        resources: ['*'],
        actions: ['logs:PutLogEvents', 'logs:CreateLogStream'],
        effect: iam.Effect.ALLOW,
      }),
    );
    taskExecutionRole.addToPolicy(
      new iam.PolicyStatement({
        resources: ['*'],
        actions: ['ecr:GetAuthorizationToken'],
        effect: iam.Effect.ALLOW,
      }),
    );
    return taskExecutionRole
  }

  prepareAppSecurityGroup(vpc: ec2.IVpc, extLbSG: ec2.ISecurityGroup, dbSG: ec2.ISecurityGroup): ec2.SecurityGroup {
    const appSG = new ec2.SecurityGroup(this, 'AppSG', { vpc , allowAllOutbound: false });
    // all call to the app must go thru its ALB
    appSG.addIngressRule(ec2.Peer.securityGroupId(extLbSG.securityGroupId), ec2.Port.tcp(80));
    // the app needs to connect to its PostgreSQL
    appSG.addEgressRule(ec2.Peer.securityGroupId(dbSG.securityGroupId), ec2.Port.tcp(5432));
    // needed to pull docker from ECR, get DB credentials from Secrets Manager. Can be further restricted.
    appSG.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443));
    return appSG
  }
  
}
