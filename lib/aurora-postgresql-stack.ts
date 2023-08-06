import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as aas from 'aws-cdk-lib/aws-applicationautoscaling';

interface DBScaling {
  minCapacity: number
  maxCapacity: number
  trackMetric?: aas.BasicTargetTrackingScalingPolicyProps
  basicStepScalingPolicy?: aas.BasicStepScalingPolicyProps
}
interface DbParam {
  key: string
  value: string
}
// selected fields from rds.DatabaseProxyProps
interface RdsProxyProps {
  debugLogging: boolean
}
interface AuroraPostgreSqlStackProps extends cdk.StackProps {
  vpcName: string
  vpcSubnets: ec2.SubnetSelection
  auroraVersion: rds.AuroraPostgresEngineVersion
  defaultDatabaseName: string
  dbPort: number
  dbParams: DbParam[]
  allowInboundFrom: ec2.IPeer[]
  dbScaling?: DBScaling
  backup?: rds.BackupProps,
  rdsProxy?: RdsProxyProps,
  // 1, 5, 10, 15, 30, or 60
  monitoringInterval: cdk.Duration,
  // serverless only
  serverlessV2MinCapacity?: number,
  serverlessV2MaxCapacity?: number,
  //  provisioned only
  dbInstanceType?: ec2.InstanceType
}
export class AuroraPostgreSqlStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AuroraPostgreSqlStackProps) {
    super(scope, id, props);
    const vpc = ec2.Vpc.fromLookup(this, 'vpc', {vpcName: props.vpcName});

    // security group
    const dbSecurityGroup = new ec2.SecurityGroup(this, "sg", {
      vpc: vpc,
      allowAllOutbound: false,
      description: "Security Group For the RDS Aurora Cluster.",
    });
    for(let peer of props.allowInboundFrom) {
      dbSecurityGroup.addIngressRule(peer, ec2.Port.tcp(props.dbPort))
    }

    // db param group
    const dbEngine = rds.DatabaseClusterEngine.auroraPostgres({
      version: props.auroraVersion,
    });
    const dbParamGrp = new rds.ParameterGroup(this, 'param-grp', {
      engine: dbEngine
    });
    for(let param of props.dbParams) {
      dbParamGrp.addParameter(param.key, param.value)
    }

    const dbCreds = rds.Credentials.fromGeneratedSecret('postgres');

    const dbWriter = props.dbInstanceType ? rds.ClusterInstance.provisioned('writer', {
      enablePerformanceInsights: true,
      parameterGroup: dbParamGrp,
      instanceType: props.dbInstanceType,
    }): rds.ClusterInstance.serverlessV2('writer', {
      enablePerformanceInsights: true,
      parameterGroup: dbParamGrp,
    })
    // for failover. scale with writer
    const dbReader1 = props.dbInstanceType ? rds.ClusterInstance.provisioned('provisioned-reader1', {
      enablePerformanceInsights: true,
      parameterGroup: dbParamGrp,
      instanceType: props.dbInstanceType,
    }): rds.ClusterInstance.serverlessV2('serverless-reader1', {
      enablePerformanceInsights: true,
      parameterGroup: dbParamGrp,
      scaleWithWriter: true,
    })
    // aurora cluster
    const auroraCluster = new rds.DatabaseCluster(this, "db", {
      engine: dbEngine,
      credentials: dbCreds,
      vpc: vpc,
      vpcSubnets: props.vpcSubnets,
      writer: dbWriter,
      readers: [
        dbReader1
      ],
      serverlessV2MinCapacity: props.serverlessV2MinCapacity,
      serverlessV2MaxCapacity: props.serverlessV2MaxCapacity,
      storageEncrypted: true,
      monitoringInterval: props.monitoringInterval,
      backup: props.backup,
      port: props.dbPort,
      defaultDatabaseName: props.defaultDatabaseName,
      instanceUpdateBehaviour: rds.InstanceUpdateBehaviour.ROLLING,
      deletionProtection: false,
      securityGroups: [dbSecurityGroup]
    });

    // autoscaling
    if (props.dbScaling) {
      const readCapacity = new aas.ScalableTarget(
        this,
        'rds-scaling',
        {
          serviceNamespace: aas.ServiceNamespace.RDS,
          minCapacity: props.dbScaling.minCapacity,
          maxCapacity: props.dbScaling.maxCapacity,
          resourceId: 'cluster:'+auroraCluster.clusterIdentifier,
          scalableDimension: 'rds:cluster:ReadReplicaCount',
        }
      );
      if(props.dbScaling.trackMetric) {
        readCapacity.scaleToTrackMetric(
          'rdsScalingTracking', props.dbScaling.trackMetric
        );
      } else if(props.dbScaling.basicStepScalingPolicy) {
        readCapacity.scaleOnMetric('rdsScalingOnMetric', props.dbScaling.basicStepScalingPolicy)
      }
    }
    new cdk.CfnOutput(this, `cluster-endpoint`, {
      value: auroraCluster.clusterEndpoint.hostname,
      description: `Cluster endpoint`,
    });
    new cdk.CfnOutput(this, `cluster-reader-endpoint`, {
      value: auroraCluster.clusterReadEndpoint.hostname,
      description: `Cluster reader endpoint`,
    });
    new cdk.CfnOutput(this, `db-creds-secret-arn`, {
      value: auroraCluster.secret?.secretArn || '',
      description: `DB creds secret arn`,
    });
    new cdk.CfnOutput(this, `db-securityGroupId`, {
      value: dbSecurityGroup.securityGroupId || '',
      description: `DB security group id`,
    });
    // if(props.rdsProxy) {
    //   const proxy = auroraCluster.addProxy("aurora-proxy", {
    //     debugLogging: props.rdsProxy.debugLogging,
    //     secrets: [dbCreds.secret!!],
    //     vpc,
    //     securityGroups: [dbSecurityGroup],
    //   });
    // }
  }
  //TODO: serverless https://www.codewithyou.com/blog/aurora-serverless-v2-with-aws-cdk
  // https://aws.plainenglish.io/set-up-aurora-serverless-and-rds-proxy-with-aws-cdk-ff1a1b216c65
}
