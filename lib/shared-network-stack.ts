import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

interface SharedNetworkStackProps extends cdk.StackProps {
  vpcName: string,
  // domainName?: string,
  certArn?: string,
  createInternalLb: boolean
}

export class SharedNetworkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SharedNetworkStackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, 'vpc', {vpcName: props.vpcName});
    const extLbSG = new ec2.SecurityGroup(this, 'ext-lb-sg', { vpc });
    extLbSG.addEgressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(443));
    extLbSG.addEgressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(80));
    const extLb = new elbv2.ApplicationLoadBalancer(this, 'ext-alb', { vpc, internetFacing: true, securityGroup: extLbSG });
    
    // const domainAlternativeName = '*.' + props.domainName;
    // one time setup. I did manually on console
    // const cert = new acm.Certificate(this, 'cert', {
    //   domainName: props.domainName,
    //   subjectAlternativeNames: [domainAlternativeName],
    //   validation: acm.CertificateValidation.fromDns(),
    // });


    const default404 = elbv2.ListenerAction.fixedResponse(404, {contentType: 'application/json', messageBody: `{"status":404}`})

    const extListener = props.certArn ? extLb.addListener('ext-listener', {
      open: true,
      certificates: [acm.Certificate.fromCertificateArn(this, 'cert', props.certArn)],
      protocol: elbv2.ApplicationProtocol.HTTPS,
      defaultAction: default404
    }) : extLb.addListener('ext-listener', {
      open: true,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: default404
    });

    new cdk.CfnOutput(this, `ext-lb-endpoint`, {
      value: extLb.loadBalancerDnsName,
      description: `ext-lb-endpoint`,
    });
    new cdk.CfnOutput(this, `ext-lb-arn`, {
      value: extLb.loadBalancerArn,
      description: `ext-lb-arn`,
    });
    new cdk.CfnOutput(this, `ext-listener-arn`, {
      value: extListener.listenerArn,
      description: `ext-listener-arn`,
    });
    new cdk.CfnOutput(this, `ext-lb-sg-id`, {
      value: extLbSG.securityGroupId,
      description: `ext-lb-sg-id`,
    });

    if(props.createInternalLb) {
      const intLbSG = new ec2.SecurityGroup(this, 'int-lb-sg', { vpc });
      intLbSG.addEgressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(443));
      intLbSG.addEgressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(80));
      const intLb = new elbv2.ApplicationLoadBalancer(this, 'int-alb', { vpc, internetFacing: false, securityGroup: intLbSG });

      const intListener = extLb.addListener('int-listener', {
        protocol: elbv2.ApplicationProtocol.HTTP,
        defaultAction: default404,
      });

      new cdk.CfnOutput(this, `int-lb-endpoint`, {
        value: intLb.loadBalancerDnsName,
        description: `int-lb-endpoint`,
      });
      new cdk.CfnOutput(this, `int-lb-arn`, {
        value: intLb.loadBalancerArn,
        description: `int-lb-arn`,
      });
      new cdk.CfnOutput(this, `int-lb-sg-id`, {
        value: intLbSG.securityGroupId,
        description: `int-lb-sg-id`,
      });

    }
  }
  
}
