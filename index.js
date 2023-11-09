const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");

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
  const instanceName = "MyEC2Instance";
  const securityGroup = new aws.ec2.SecurityGroup("app-sec-group", {
    vpcId: vpcId,
    ingress: [
      {
        protocol: "tcp",
        fromPort: 22,
        toPort: 22,
        cidrBlocks: ["0.0.0.0/0"],
      },
      {
        protocol: "tcp",
        fromPort: 80,
        toPort: 80,
        cidrBlocks: ["0.0.0.0/0"],
      },
      {
        protocol: "tcp",
        fromPort: 443,
        toPort: 443,
        cidrBlocks: ["0.0.0.0/0"],
      },
      {
        protocol: "tcp",
        fromPort: 3001,
        toPort: 3001,
        cidrBlocks: ["0.0.0.0/0"],
      },
    ],
    egress: [
      {
        fromPort: 3306,      // Allow outbound traffic on port 3306
        toPort: 3306,        // Allow outbound traffic on port 3306
        protocol: "tcp",     // TCP protocol
        cidrBlocks: ["0.0.0.0/0"],  // Allow all destinations
      },
    ],
    
  })
  const rdsParameterGroup = new aws.rds.ParameterGroup("customrdsparamgroup", {
    family: "mysql8.0", // Replace with the appropriate RDS engine and version
    parameters: [
        {
            name: "max_connections",
            value: "100",
        },
        // Add more parameters as needed
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
    });
    const rdsInstance = new aws.rds.Instance('my-rds-instance', {
      allocatedStorage: 20,
      storageType: 'gp2',
      engine: "mysql", // Replace with 'postgres' or 'mariadb' as needed
      instanceClass: 'db.t2.micro', // Use the cheapest available class
      name: 'csye6225',
      username:'csye6225',
      password: 'sheetalcsye', // Replace with a strong password
      skipFinalSnapshot: true, // Prevent the creation of a final snapshot when deleting the RDS instance
      multiAz: false, // No Multi-AZ deployment
      dbSubnetGroupName: dbsubnetgroup, // Replace with the name of your private subnet group
      publiclyAccessible: false, // No public accessibility
      vpcSecurityGroupIds: [dbSecurityGroup.id], // Replace with the ID of your Database security group
      parameterGroupName:rdsParameterGroup,
  });
  

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

});
const instanceProfile = new aws.iam.InstanceProfile(
  "instanceProfileName", {
  role: cloudWatchAgentRole.name,
  dependsOn: [rolePolicyAttachment] 
 
});
  const ec2Inst = new aws.ec2.Instance(instanceName, {
    ami:aws.ec2.getAmi({
      owners: [owner],
      mostRecent: true,
      filters: [{ name: "state", values: ["available"] }],
    }).then((ami) => ami.id),
    dependsOn:rdsInstance,
    iamInstanceProfile: instanceProfile.name,
    userData:pulumi.interpolate `
    #!/bin/bash
    cd /home/admin/WebApp
    chmod +w .env
    editable_file=".env"  
    mysql_database=${rdsInstance.dbName}
    mysql_user=${rdsInstance.username}
    mysql_password=${rdsInstance.password}
    mysql_port=${rdsInstance.port}
    mysql_host=${rdsInstance.address}
    db_dialect=${rdsInstance.engine}
       
    if [ -f "$editable_file" ]; then
           
    > "$editable_file"
       
        # Add new key-value pairs
        echo "MYSQL_DATABASE=$mysql_database" >> "$editable_file"
        echo "MYSQL_USER=$mysql_user" >> "$editable_file"
        echo "MYSQL_PASSWORD=$mysql_password" >> "$editable_file"
        echo "MYSQL_PORT=$mysql_port" >> "$editable_file"
        echo "MYSQL_HOST=$mysql_host" >> "$editable_file"
        echo "DB_DIALECT=$db_dialect" >> "$editable_file"
       
        echo "Cleared old data in $editable_file and added new key-value pairs."
    else
        echo "File $editable_file does not exist."
    fi
    sudo chown csye6225:csye6225 /home/admin/WebApp
 
    sudo chmod 750 /home/admin/WebApp

    sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config \
    -m ec2 \
    -c file:/opt/cloudwatch-config.json \
    -s

    `.apply((s)=>s.trim()),
    instanceType: "t2.micro",
    vpcSecurityGroupIds: [securityGroup.id],
    associatePublicIpAddress: true,
    subnetId: publicSubnets[0].id,
    keyName: "ec2dev",
    tags: { Name: instanceName },
    rootBlockDevice: {
      volumeSize: 25,
      volumeType: "gp2",
      deleteOnTermination: true,
    },
  });
  //for A record creation
    //const baseDomainName = config.require("basedomain"); 
    const baseDomainName = "dev.sheetalpujari.me";
    const zonePromise = aws.route53.getZone({ name: baseDomainName }, { async: true });

    zonePromise.then(zone => {

    const record = new aws.route53.Record("myRecord", {
    zoneId: zone.zoneId, 
    name: "",
    type: "A",
    ttl: 60,
    records: [ec2Inst.publicIp],
}, { dependsOn: [ec2Inst]});
});
});
