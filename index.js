const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const gcp = require("@pulumi/gcp")
const AWS = require('aws-sdk');
const lambda = new AWS.Lambda();
const config = new pulumi.Config();
const azCount = config.getNumber("azCount");
const vpcCidr = config.require("vpcCidr");
const cidr = config.require("cidr");
const publicSubnets = [];
const privateSubnets = [];
const subnetSuffix = config.require("subnetSuffix");
const state = config.require("state");
const vpcName = config.require("vpcName");
const igwName = config.require("igwName");
const publicSta = config.require("public");
const destCidr = config.require("destCidr");
const pubRouteAssoc = config.require("pubRouteAssoc");
const privRouteAssoc = config.require("privRouteAssoc");
const privateSta = config.require("private");
const pubSubnet = config.require("pubSubnet");
const privSubnet = config.require("privSubnet");
const pubRt = config.require("pubRt");
const privRt = config.require("privRt");
const pubRoute = config.require("pubRoute");
const owner = config.require("owner");



function getFirstNAz(data, n) {
  const azCount = data.names.length;

  if (azCount >= n) {
    return data.names.slice(0, n);
  } else {
    return data.names;
  }
}
const azNames = [];
aws.getAvailabilityZones({ state: state }).then((data) => {
  const azs = getFirstNAz(data, azCount);
  const vpc = new aws.ec2.Vpc(vpcName, {
    cidrBlock: vpcCidr,
    availabilityZones: azs,
  });
  const igw = new aws.ec2.InternetGateway(igwName, {
    vpcId: vpc.id,
  });

  for (let i = 0; i < azs.length; i++) {
    const az = azs[i];
    azNames.push(az);
  }

  const calcCidr = (index, subnetType) => {
    const subnetNum = subnetType === publicSta ? index : index + azCount;
    return `${cidr}.${subnetNum}${subnetSuffix}`;
  };

  for (let i = 0; i < azNames.length; i++) {
    const az = azNames[i];

    const pubSub = new aws.ec2.Subnet(`${pubSubnet}-${az}-${i}`, {
      vpcId: vpc.id,
      cidrBlock: calcCidr(i, publicSta),
      availabilityZone: az,
      mapPublicIpOnLaunch: true,
      tags: {
        Name: pubSubnet,
      },
    });

    const privSub = new aws.ec2.Subnet(`${privSubnet}-${az}-${i}`, {
      vpcId: vpc.id,
      cidrBlock: calcCidr(i, privateSta),
      availabilityZone: az,
      tags: {
        Name: privSubnet,
      },
    });

    publicSubnets.push(pubSub);
    privateSubnets.push(privSub);
  }

  const pubRtTable = new aws.ec2.RouteTable(pubRt, {
    vpcId: vpc.id,
    tags: {
      Name: pubRt,
    },
  });

  const privRtTable = new aws.ec2.RouteTable(privRt, {
    vpcId: vpc.id,
    tags: {
      Name: privRt,
    },
  });

  const pubRtEntry = new aws.ec2.Route(pubRoute, {
    routeTableId: pubRtTable.id,
    destinationCidrBlock: destCidr,
    gatewayId: igw.id,
  });

  publicSubnets.forEach((subnet, i) => {
    new aws.ec2.RouteTableAssociation(
      `${pubRouteAssoc}-${subnet.availabilityZone}-${i}`,
      {
        subnetId: subnet.id,
        routeTableId: pubRtTable.id,
        tags: {
          Name: pubRouteAssoc,
        },
      }
    );
  });

  privateSubnets.forEach((subnet, i) => {
    new aws.ec2.RouteTableAssociation(
      `${privRouteAssoc}-${subnet.availabilityZone}-${i}`,
      {
        subnetId: subnet.id,
        routeTableId: privRtTable.id,
        tags: {
          Name: privRouteAssoc,
        },
      }
    );
  });

  const vpcId = vpc.id;
  
  const loadBalancerSecurityGroup = new aws.ec2.SecurityGroup("loadBalancerSecurityGroup", {
    vpcId:vpc.id,
    ingress: [
        {
            protocol: "tcp",
            fromPort: 80,
            toPort: 80,
            cidrBlocks: ["0.0.0.0/0"], // Allow traffic from anywhere on port 80
        },
        {
            protocol: "tcp",
            fromPort: 443,
            toPort: 443,
            cidrBlocks: ["0.0.0.0/0"], // Allow traffic from anywhere on port 443
        },
    ],
    egress:[
      {
        protocol:"-1",
        fromPort:0,
        toPort:0,
        cidrBlocks:["0.0.0.0/0"],
      }
    ]
  });
  const securityGroup = new aws.ec2.SecurityGroup("app-sec-group", {
    vpcId: vpcId,
    ingress: [
      {
        protocol: "tcp",
        fromPort: 22,
        toPort: 22,
        securityGroups:[loadBalancerSecurityGroup.id],
      },
      {
        protocol: "tcp",
        fromPort: 3001,
        toPort: 3001,
        securityGroups:[loadBalancerSecurityGroup.id], // Allow traffic from the load balancer security group
    },
    ],
    egress: [
      {
        fromPort: 0,      // Allow outbound traffic on port 3306
        toPort: 0,        // Allow outbound traffic on port 3306
        protocol: -1,     // TCP protocol
        cidrBlocks:["0.0.0.0/0"],  // Allow all destinations
      }
    ],
  },{
    dependsOn:[loadBalancerSecurityGroup],
  });

  const rdsParameterGroup = new aws.rds.ParameterGroup("customrdsparamgroup", {
    family: "mysql8.0", // Replace with the appropriate RDS engine and version
    parameters: [
        {
            name: "max_connections",
            value: "100",
        },
    ],
    });
   const dbsubnetgroup = new aws.rds.SubnetGroup("rdssubnetgroup", {
      subnetIds: privateSubnets.map(subnet => subnet.id),
      description:"My rds subnet group for private subnets",
  })
  const dbSecurityGroup = new aws.ec2.SecurityGroup("db-sg", {
      vpcId: vpc.id,
      ingress: [
          {
              fromPort: 3306, // For MariaDB
              toPort: 3306, // For MariaDB
              protocol: "tcp",
              securityGroups: [securityGroup.id], // Referencing the application security group as source
          },
      ],
      egress: [
          {
              fromPort: 0,
              toPort: 0,
              protocol: "-1",
              cidrBlocks: ["0.0.0.0/0"],
          },
      ],
    },{
      dependsOn:[securityGroup],
    });

    const rdsInstance = new aws.rds.Instance('my-rds-instance', {
      vpcId: vpc.id,
      allocatedStorage: 20,
      storageType: 'gp2',
      engine: "mysql", // Replace with 'postgres' or 'mariadb' as needed
      instanceClass: 'db.t2.micro', // Use the cheapest available class
      name: 'csye6225',
      username:'csye6225',
      password: 'sheetalcsye', // Replace with a strong password
      skipFinalSnapshot: true, // Prevent the creation of a final snapshot when deleting the RDS instance
      multiAz: false, // No Multi-AZ deployment
      dbSubnetGroupName: dbsubnetgroup.name, // Replace with the name of your private subnet group
      publiclyAccessible: false, // No public accessibility
      vpcSecurityGroupIds: [dbSecurityGroup.id], // Replace with the ID of your Database security group
      parameterGroupName:rdsParameterGroup.name,
  },{dependsOn:[dbsubnetgroup,dbSecurityGroup,rdsParameterGroup]});
  

  const cloudWatchAgentRole = new aws.iam.Role("AgentRole", {
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: {
                Service: "ec2.amazonaws.com"
            }
        }]
    })
});
const rolePolicyAttachment = new aws.iam.RolePolicyAttachment("cloudwatchAgentPolicyAttachment", {
  policyArn: "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy",
  role: cloudWatchAgentRole.name,
},{ dependsOn: [cloudWatchAgentRole] });

const snsTopic = new aws.sns.Topic("mySnsTopic");
const bucket = new gcp.storage.Bucket("bujk", {
  name:"bujk",
  location: "US",
  ForceDelete: true
});
const userdat = pulumi.interpolate
`#!/bin/bash
cd /home/admin/WebApp
chmod +w .env
editable_file=".env"  
mysql_database=${rdsInstance.dbName}
mysql_user=${rdsInstance.username}
mysql_password=${rdsInstance.password}
mysql_port=${rdsInstance.port}
mysql_host=${rdsInstance.address}
db_dialect=${rdsInstance.engine}
topicArn = ${snsTopic.arn}
bucketname = ${bucket.name}
if [ -f "$editable_file" ]; then
      
> "$editable_file"
    # Add new key-value pairs
    echo "MYSQL_DATABASE=$mysql_database" >> "$editable_file"
    echo "MYSQL_USER=$mysql_user" >> "$editable_file"
    echo "MYSQL_PASSWORD=$mysql_password" >> "$editable_file"
    echo "MYSQL_PORT=$mysql_port" >> "$editable_file"
    echo "MYSQL_HOST=$mysql_host" >> "$editable_file"
    echo "DB_DIALECT=$db_dialect" >> "$editable_file"
    echo "TopicArn=$topicArn" >> "$editable_file"
    echo "Bucketname=$bucketname" >> "$editable_file"
    
    echo "Cleared old data in $editable_file and added new key-value pairs."
else
    echo "File $editable_file does not exist."
fi
sudo chown csye6225:csye6225 /home/admin/WebApp

sudo chmod 750 /home/admin/WebApp

sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
-a fetch-config \
-m ec2 \
-c file:/opt/aws/amazon-cloudwatch-agent/bin/cloud-watch-agent.json \
-s
`
const instanceProfile = new aws.iam.InstanceProfile(
  "instanceProfileName", {
  role: cloudWatchAgentRole.name,
},{dependsOn:[rolePolicyAttachment]});
// const amiID = aws.ec2.getAmi({
//   owners: [owner],
//   mostRecent: true,
//   filters: [{ name: "state", values: ["available"] }],
// }).then((ami) => ami.id)

const launchTemplate = new aws.ec2.LaunchTemplate("webAppLaunchTemplate", {
  imageId:"ami-0c075751a0946a37e",
  instanceType: "t2.micro",
  // LaunchTemplateData: {
  //     InstanceType: "t2.micro", 
  // },
  keyName: "ec2dev",
  iamInstanceProfile: {
      name: instanceProfile.name,
  },
  tagSpecifications: [{
    resourceType: "instance",
    tags: {
        Name: "Ec2Instance",
    },
}],
  networkInterfaces : [
    {
      securityGroups : [securityGroup.id],
      deleteOnTermination: true
    }],
  userData: userdat.apply(script=>Buffer.from(script).toString("base64")),
},{dependsOn:[instanceProfile,rdsInstance]});

const targetGroup = new aws.lb.TargetGroup("webAppTargetGroup", {
  port: 3001,
  protocol: "HTTP",
  targetType:"instance",
  vpcId: vpc.id,
  associatePublicIpAddress:true,
  healthCheck: {
      path: "/healthz", 
      port: 3001,
      protocol:"HTTP",
      timeout:10,
      interval: 30,
      unhealthyThreshold:3,
      healthyThreshold:3,
  },
},{dependsOn:launchTemplate});
const sslCertificateArn = "arn:aws:acm:us-east-1:413925622897:certificate/40efd052-e507-4cbf-9f24-5f70ab7bc823";

const loadBalancer = new aws.lb.LoadBalancer("webAppLoadBalancer", {
  internal:false,
  loadBalancerType:"application",
  securityGroups: [loadBalancerSecurityGroup.id],
  subnets: publicSubnets,
  enableDeletionProtection: false,
},{dependsOn:targetGroup,rdsInstance});

const listener = new aws.lb.Listener("webAppListener", {
  loadBalancerArn: loadBalancer.arn,
  port: 443,
  protocol: "HTTPS",
  sslPolicy: "ELBSecurityPolicy-2016-08",
  certificateArn: sslCertificateArn,
  certificates: [{
    certificateArn: sslCertificateArn, 
  }],
  defaultActions: [
      {
          type: "forward",
          targetGroupArn: targetGroup.arn,
      },
  ],
},{dependsOn: loadBalancer,targetGroup});

const autoScalingGroup = new aws.autoscaling.Group("webAppAutoScalingGroup", {
  vpc:vpc.id,
  vpcZoneIdentifiers: publicSubnets.map(subnet => subnet.id),
  healthCheckType:"EC2",
  healthCheckGracePeriod: 300,
  launchTemplate:{
    id:launchTemplate.id,
    version:"$Latest",
  },
  forceDelete: true,
  minSize: 1,
  maxSize: 3,
  desiredCapacity: 1,
  targetGroupArns:[targetGroup.arn],
},{dependsOn:[listener]});

const scaleUpPolicy = new aws.autoscaling.Policy("scaleUpPolicy", {
  scalingAdjustment: 1,
  adjustmentType: "ChangeInCapacity",
  cooldown: 60,
  autoscalingGroupName: autoScalingGroup.name,
  name: "scaleUpPolicy",
  metricAggregationType: "Average",
},{dependsOn:autoScalingGroup});

const scalingUpcloudWatchMetricAlarm = new aws.cloudwatch.MetricAlarm("scalingUpcloudWatchMetricAlarm", {
  comparisonOperator: "GreaterThanOrEqualToThreshold",
  evaluationPeriods: 1,
  metricName: "CPUUtilization",
  namespace: "AWS/EC2",
  period: 60,
  statistic: "Average",
  threshold: 5,
  dimensions: {
      AutoScalingGroupName: autoScalingGroup.name,
  },
  alarmDescription: "ec2 cpu utilization",
  alarmActions: [scaleUpPolicy.arn],
},{dependsOn:scaleUpPolicy});

const scaleDownPolicy = new aws.autoscaling.Policy("scaleDownPolicy", {
  scalingAdjustment: -1,
  adjustmentType: "ChangeInCapacity",
  cooldown: 60,
  autoscalingGroupName: autoScalingGroup.name,
  name: "scaleDownPolicy",
  metricAggregationType: "Average",
},{dependsOn:autoScalingGroup});

const scalingDowncloudWatchMetricAlarm = new aws.cloudwatch.MetricAlarm("scalingDowncloudWatchMetricAlarm", {
  comparisonOperator: "LessThanOrEqualToThreshold",
  evaluationPeriods: 1,
  metricName: "CPUUtilization",
  namespace: "AWS/EC2",
  period: 60,
  statistic: "Average",
  threshold: 3,
  dimensions: {
      AutoScalingGroupName: autoScalingGroup.name,
  },
  alarmDescription: "ec2 cpu utilization",
  alarmActions: [scaleDownPolicy.arn],
},{dependsOn:scaleDownPolicy});

const lambdaRole = new aws.iam.Role("lambdaRole", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
        Action: "sts:AssumeRole",
        Effect: "Allow",
        Sid: "AssumeRolePolicy", 
        Principal: {
            Service: "lambda.amazonaws.com",
        },
    }],
})
});

const serviceAccount = new gcp.serviceaccount.Account("myServiceAccount", {
  accountId: "developer-406202",
  displayName: "My Service Account"
});
const serviceAccountKey = new gcp.serviceaccount.Key("myServiceAccountKey", {
  serviceAccountId: serviceAccount.accountId,
});


const lambdaPolicy = new aws.iam.Policy("lambdaPolicy", {
  policy: {
  "Version": "2012-10-17",
  "Statement": [
      {
          "Effect": "Allow",
          "Action": [
              "logs:CreateLogGroup",
              "logs:CreateLogStream",
              "logs:PutLogEvents",
              "lambda:InvokeFunction",
          ],
          "Resource": "*"
      }
  ]
  },
});
const SnsTopicPolicy = new aws.iam.Policy("SNSPolicy", {
  policy: {
  "Version": "2012-10-17",
  "Statement": [
      {
          "Effect": "Allow",
          "Action": [
               "sns:Publish",
          ],
          "Resource": "*"
      }
  ]
  },
});
const dynamotable = new aws.dynamodb.Table("myTable",{
  attributes: [
      {
          name: "emailId",
          type: "S",
      },
      {
          name: "status",
          type: "S",
      },
      {
          name: "timestamp",
          type: "S",
      }
  ],
  hashKey: "emailId",
  billingMode: "PAY_PER_REQUEST",
  globalSecondaryIndexes: [
      {
          name: "status",
          hashKey: "status",
          projectionType: "ALL",
          readCapacity: 1,
          writeCapacity: 1,
      },
      {
          name: "timestamp",
          hashKey: "timestamp",
          projectionType: "ALL",
          readCapacity: 1,
          writeCapacity: 1,
      }
  ],
  })

const dynamodbPolicy = new aws.iam.Policy("dynamodbPolicy", {
  policy: {
      "Version": "2012-10-17",
      "Statement": [
          {
              "Effect": "Allow",
              "Action": [
                  "dynamodb:GetItem",
                  "dynamodb:PutItem",
                  "dynamodb:UpdateItem",
                  "dynamodb:BatchWriteItem",
                  "dynamodb:Query",
                  "dynamodb:Scan",
                  "dynamodb:DeleteItem"
              ],
              "Resource": "*"
          }
      ]
  },
});
const lambdaRolePolicyAttachment = new aws.iam.RolePolicyAttachment("lambdaRolePolicyAttachment", {
  policyArn: lambdaPolicy.arn,
  role: lambdaRole.name,
});
const attachSNS = new aws.iam.RolePolicyAttachment("SNSPolicyAttachment", {
  role: lambdaRole.name,
  policyArn: SnsTopicPolicy.arn,
},{ dependsOn: [lambdaRole] });

const attachDynamoDbPolicy = new aws.iam.RolePolicyAttachment("dynamodbPolicyAttachment", {
  policyArn: dynamodbPolicy.arn,
  role: lambdaRole.name,
});
const domain = "dev.sheetalpujari.me"
const lambdaFunction = new aws.lambda.Function("myLambdaFunction", {
  handler: "serverless/index.handler", 
  runtime: "nodejs14.x",
  code: new pulumi.asset.FileArchive("/Users/sheetalpujari/serverless/serverless.zip"),
  packageType: "Zip",
  environment: {
      variables: {
          GCP_SERVICE_ACCOUNT_KEY: serviceAccountKey.privateKeyData,
          BUCKET_NAME: bucket.name, 
          DOMAIN:domain, 
          AWS_DYNAMODB_TABLE:dynamotable.name,
      
      },
  },
  role: lambdaRole.arn,
},{ dependsOn: [serviceAccountKey] });


const lambdaSubscription = new aws.sns.TopicSubscription("lambdaSubscription", {
  protocol: "lambda",
  endpoint: lambdaFunction.arn,
  topic: snsTopic.arn,
});
const permission = new aws.lambda.Permission("myPermission", {
  action: "lambda:InvokeFunction",
  function: lambdaFunction.id,
  principal: "sns.amazonaws.com",
  sourceArn: snsTopic.arn
});
    // const ec2Inst = new aws.ec2.Instance(instanceName, {
    //   ami:"ami-0c40cbdc2a509a7ee",
    //   // aws.ec2.getAmi({
    //   //   owners: [owner],
    //   //   mostRecent: true,
    //   //   filters: [{ name: "state", values: ["available"] }],
    //   // }).then((ami) => ami.id),
    //   dependsOn:rdsInstance,
    //   iamInstanceProfile: instanceProfile.name,
    //   userData:pulumi.interpolate `
    //   #!/bin/bash
    //   cd /home/admin/WebApp
    //   chmod +w .env
    //   editable_file=".env"  
    //   mysql_database=${rdsInstance.dbName}
    //   mysql_user=${rdsInstance.username}
    //   mysql_password=${rdsInstance.password}
    //   mysql_port=${rdsInstance.port}
    //   mysql_host=${rdsInstance.address}
    //   db_dialect=${rdsInstance.engine}
    //   topicArn = ${snsTopic.arn}
    //   bucketname = ${bucket.name}
    //   if [ -f "$editable_file" ]; then
            
    //   > "$editable_file"
        
    //       # Add new key-value pairs
    //       echo "MYSQL_DATABASE=$mysql_database" >> "$editable_file"
    //       echo "MYSQL_USER=$mysql_user" >> "$editable_file"
    //       echo "MYSQL_PASSWORD=$mysql_password" >> "$editable_file"
    //       echo "MYSQL_PORT=$mysql_port" >> "$editable_file"
    //       echo "MYSQL_HOST=$mysql_host" >> "$editable_file"
    //       echo "DB_DIALECT=$db_dialect" >> "$editable_file"
    //       echo "TopicArn=$topicArn" >> "$editable_file"
    //       echo "Bucketname"=$bucketname" >> "$editable_file"
    //       echo "Cleared old data in $editable_file and added new key-value pairs."
    //   else
    //       echo "File $editable_file does not exist."
    //   fi
    //   sudo chown csye6225:csye6225 /home/admin/WebApp

    //   sudo chmod 750 /home/admin/WebApp

    //   sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    //   -a fetch-config \
    //   -m ec2 \
    //   -c file:/opt/aws/amazon-cloudwatch-agent/bin/cloudwatch-config.json \
    //   -s
    //   # Install Google Cloud SDK (gcloud)
    //   curl -O https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-sdk-VERSION-linux-x86_64.tar.gz
    //   tar -zxvf google-cloud-sdk-VERSION-linux-x86_64.tar.gz
    //   ./google-cloud-sdk/install.sh

    //   gcloud auth activate-service-account --key-file=<(echo '${serviceAccountKey.privateKey}')  
    //   gsutil ls gs://gcp-bucket
    //   `.apply((s)=>s.trim()),
    //   instanceType: "t2.micro",
    //   vpcSecurityGroupIds: [securityGroup.id],
    //   associatePublicIpAddress: true,
    //   subnetId: publicSubnets[0].id,
    //   keyName: "ec2dev",
    //   tags: { Name: instanceName },
    //   rootBlockDevice: {
    //     volumeSize: 25,
    //     volumeType: "gp2",
    //     deleteOnTermination: true,
    //   },
    // });
    
    const hostedZone = aws.route53.getZone({
      name:domain,
    });
    hostedZone.then(zone => {
    const port = 3001;
    const aRecord = new aws.route53.Record('csye-6225', {
    name: domain,
    zoneId: zone.id,
    type: 'A',
    aliases: [
      {
        name: loadBalancer.dnsName,
        zoneId: loadBalancer.zoneId,
        evaluateTargetHealth: true,
      },
     ]
       });
    },
    {dependsOn:[autoScalingGroup]});

});