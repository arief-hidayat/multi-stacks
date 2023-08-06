import { Stack, StackProps } from 'aws-cdk-lib';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

interface VpcStackProps extends StackProps {
  vpc: VpcConfig
}
interface VpcConfig {
  name: string
  // either props or just define cidr
  props?: ec2.VpcProps
  cidr?: string
  maxAzs?: number
}

export class VpcStack extends Stack {
  constructor(scope: Construct, id: string, props: VpcStackProps) {
    super(scope, id, props);
    const vpcProps = props.vpc.props || {
      ipAddresses: ec2.IpAddresses.cidr(props.vpc.cidr || '10.1.0.0/16'),
      maxAzs: props.vpc.maxAzs || 2,
      vpcName: props.vpc.name,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    }
    const vpc = new ec2.Vpc(this, props.vpc.name, vpcProps);

    const cntrVpceSg = new ec2.SecurityGroup(this, 'cntr-vpce-sg', { vpc });
    const secretsMgrVpcEndpoint = new ec2.InterfaceVpcEndpoint(this, 'sm-vpcendpoint', {
      vpc: vpc,
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      securityGroups: [cntrVpceSg]
    })

    // https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html
    const ecrVpcEndpoint = new ec2.InterfaceVpcEndpoint(this, 'ecr-vpcendpoint', {
      vpc: vpc,
      service: ec2.InterfaceVpcEndpointAwsService.ECR,
      securityGroups: [cntrVpceSg]
    })
    const ecrDkrVpcEndpoint = new ec2.InterfaceVpcEndpoint(this, 'ecr-dkr-vpcendpoint', {
      vpc: vpc,
      service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      securityGroups: [cntrVpceSg],
    })
    const cwLogsVpcEndpoint = new ec2.InterfaceVpcEndpoint(this, 'cwlogs-vpcendpoint', {
      vpc: vpc,
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      securityGroups: [cntrVpceSg]
    })
    const s3GatewayEndpoint = new ec2.GatewayVpcEndpoint(this, 's3-vpcendpoint', {
      vpc: vpc,
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      }],
    })
    s3GatewayEndpoint.addToPolicy(new iam.PolicyStatement({
      sid: 'prod-ap-southeast-3-starport-layer-bucket',
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject'],
      principals: [new iam.StarPrincipal()],
      resources: ["arn:aws:s3:::prod-ap-southeast-3-starport-layer-bucket/*"]
    }))


    new cdk.CfnOutput(this, `vcpId`, {
      value: vpc.vpcId,
      description: 'VPC ID',
    });
    new cdk.CfnOutput(this, `vpcArn`, {
      value: vpc.vpcArn,
      description: 'VPC ARN',
    });
    new cdk.CfnOutput(this, `cntrVpceSgId`, {
      value: cntrVpceSg.securityGroupId,
      description: 'Container VPC endpoint security ID',
    });
  }
}
