## What's this?
Just bunch of CDK stacks for demo ECS & EKS on Fargate.
More content might be added in future.

Use at your own risk.

## Deploying Stacks

Note: the following commands run using my specific AWS CLI profile. Please modify/remove.
Bootstrap first if you haven't.
```
cdk --profile cgk2 bootstrap
```

Deploy VPC, subnets, NAT GW, VPC endpoints, etc.
```
cdk --profile cgk2 deploy vpc 
```

Deploy Aurora for PostgreSQL (needed for [my demo app](https://github.com/arief-hidayat/gin-gorm-api))
```
cdk --profile cgk2 deploy pgdb 
```

Deploy shared resources such as Application Load Balancer(s).
It's configured with my custom domain. Please remove/modify accordingly.
```
cdk --profile cgk2 deploy shared-nw 
```

Deploy shared my demo app running on ECS Fargate
```
cdk --profile cgk2 deploy ecs-fargate 
```
## Testing

```
ECS_ALB_URL=https://$(aws --profile cgk2 cloudformation describe-stacks --stack-name shared-nw --query 'Stacks[0].Outputs[?OutputKey==`extlbendpoint`].OutputValue' --output text)
echo ECS_ALB_URL=$ECS_ALB_URL
ECS_HOST=ecs-fargate.demo.ariefh.site
http --verify=no GET $ECS_ALB_URL/api/v1/contacts Host:$ECS_HOST

http --verify=no POST $ECS_ALB_URL/api/v1/contacts Host:$ECS_HOST \
  name=Arief email=ariefh@unknown.com mobile_no=+6281363531111 institution=Unknown

http --verify=no GET $ECS_ALB_URL/api/v1/contacts Host:$ECS_HOST


ID=$(curl -XGET -k -H "Host: $ECS_HOST" "$ECS_ALB_URL/api/v1/contacts" | jq -r '.data[-1].id')
http --verify=no PUT $ECS_ALB_URL/api/v1/contacts/$ID Host:$ECS_HOST \
  name=Arief email=ariefh1@secret.com mobile_no=+6586686617 institution=Secret

http --verify=no GET $ECS_ALB_URL/api/v1/contacts Host:$ECS_HOST

http --verify=no DELETE $ECS_ALB_URL/api/v1/contacts/$ID Host:$ECS_HOST

http --verify=no GET $ECS_ALB_URL/api/v1/contacts Host:$ECS_HOST
```
