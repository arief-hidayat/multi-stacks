#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { VpcStack } from '../lib/vpc-stacks';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { AuroraPostgreSqlStack } from '../lib/aurora-postgresql-stack';
import { EcsFargateSvcStack } from '../lib/ecs-fargate-svc-stack';
import { SharedNetworkStack } from '../lib/shared-network-stack';

const app = new cdk.App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
const vpc = {
  name: 'dev',
  cidr: '168.1.0.0/16'
}
new VpcStack(app, 'vpc', {
  env: env, 
  vpc: vpc,
});

new AuroraPostgreSqlStack(app, 'pgdb', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  vpcName: vpc.name,
  vpcSubnets: {
    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
  },
  auroraVersion: rds.AuroraPostgresEngineVersion.VER_15_3,
  defaultDatabaseName: 'appdb',
  dbPort: 5432,
  dbParams: [
    // { key: 'timezone', value: 'Asia/Bangkok'}
  ],
  allowInboundFrom: [
    ec2.Peer.ipv4(vpc.cidr),
    // ec2.Peer.securityGroupId('the-app-security-group-id-that-want-to-access-db')
  ],
  serverlessV2MinCapacity: 0.5,
  serverlessV2MaxCapacity: 4,

  // dbInstanceType: ec2.InstanceType.of(ec2.InstanceClass.R6G, ec2.InstanceSize.LARGE)
  // dbScaling: {
  //   minCapacity: 1, maxCapacity: 15, 
  //   trackMetric: {
  //     targetValue: 30, 
  //     predefinedMetric: aas.PredefinedMetric.RDS_READER_AVERAGE_CPU_UTILIZATION, 
  //     scaleOutCooldown: cdk.Duration.seconds(10),
  //     scaleInCooldown: cdk.Duration.minutes(3)
  //   }
  // },
  backup: {
    retention: cdk.Duration.days(1),
    preferredWindow: '17:00-18:00'
  },
  monitoringInterval: cdk.Duration.seconds(5)
});

new SharedNetworkStack(app, 'shared-nw', {
  env: env,
  vpcName: vpc.name,
  createInternalLb: false,
  // domainName: 'ariefh.site',
  certArn: 'arn:aws:acm:ap-southeast-3:153036817431:certificate/b9097122-4c05-4d60-a43e-7df4c1316102'
})


    // depends on prev stacks
    // const dbPrimaryEndpoint = cdk.Fn.importValue('pgdb.clusterendpoint').toString()
    // const dbReaderEndpoint = cdk.Fn.importValue('pgdb.clusterreaderendpoint').toString()
    // const dbCredsSecretArn = cdk.Fn.importValue('pgdb.dbcredssecretarn').toString()
    // const dbSecurityGroupId = cdk.Fn.importValue('pgdb.dbsecurityGroupId').toString()
    // const cntrVpceSgId = cdk.Fn.importValue('vpc.cntrVpceSgId').toString()
    // const extListenerArn = cdk.Fn.importValue('shared-nw.extlistenerarn').toString()
    // const extElbSgId = cdk.Fn.importValue('shared-nw.extlbsgid').toString()
const dbPrimaryEndpoint = 'pgdb-dbecc37780-qvekxwaqvcoy.cluster-c6dmgx0flgpk.ap-southeast-3.rds.amazonaws.com'
const dbReaderEndpoint = 'pgdb-dbecc37780-qvekxwaqvcoy.cluster-ro-c6dmgx0flgpk.ap-southeast-3.rds.amazonaws.com'
const dbCredsSecretArn = 'arn:aws:secretsmanager:ap-southeast-3:153036817431:secret:pgdbSecret49C9B9AC3fdaad7ef-IFA2REqkofVY-EKm23m'
const dbSecurityGroupId = 'sg-00d706687298dd5f7'
const cntrVpceSgId = 'sg-084e33d9d6ba6189e'
const extListenerArn = 'arn:aws:elasticloadbalancing:ap-southeast-3:153036817431:listener/app/share-extal-L2X5STJ8JJJN/ad9544d367ddc4cb/ef31cd3e7d6f1700'
const extElbSgId = 'sg-0dbef24b034dd9497'
new EcsFargateSvcStack(app, 'ecs-fargate', {
  env: env,
  vpcName: vpc.name,
  dbPrimaryEndpoint: dbPrimaryEndpoint,
  dbReaderEndpoint: dbReaderEndpoint,
  dbCredsSecretArn: dbCredsSecretArn,
  dbSecurityGroupId: dbSecurityGroupId,
  cntrVpceSgId: cntrVpceSgId,
  extListenerArn: extListenerArn,
  extElbSgId: extElbSgId,
})


