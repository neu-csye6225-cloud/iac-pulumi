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
  });

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
    });
    
    const webAppSecurityGroup = new aws.ec2.SecurityGroup("webapp-sg", {
      vpcId: vpc.id,
      ingress: [
        {
          fromPort: 22,
          toPort: 22,
          protocol: "tcp",
          cidrBlocks: ["0.0.0.0/0"], // Allow SSH from anywhere
        },
        {
          fromPort: 80,
          toPort: 80,
          protocol: "tcp",
          cidrBlocks: ["0.0.0.0/0"], // Allow HTTP from anywhere
        },
        {
          fromPort: 443,
          toPort: 443,
          protocol: "tcp",
          cidrBlocks: ["0.0.0.0/0"], // Allow HTTPS from anywhere
        },
        {
          fromPort: 8080,
          toPort: 8080,
          protocol: "tcp",
          cidrBlocks: ["0.0.0.0/0"], // Allow your application traffic from anywhere
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
    });
   
    const dbSecurityGroup = new aws.ec2.SecurityGroup("db-sg", {
      vpcId: vpc.id,
      ingress: [
          {
              fromPort: 3306, // For MariaDB
              toPort: 3306, // For MariaDB
              protocol: "tcp",
              securityGroups: [webAppSecurityGroup.id], // Referencing the application security group as source
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
      engine: 'mysql', // Replace with 'postgres' or 'mariadb' as needed
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
  const ec2Inst = new aws.ec2.Instance(instanceName, {
    ami:aws.ec2.getAmi({
      owners: [owner],
      mostRecent: true,
      filters: [{ name: "state", values: ["available"] }],
    }).then((ami) => ami.id),
    dependsOn:rdsInstance,
    userData:pulumi.interpolate `
    #!/bin/bash
    cd /home/admin
    chmod +w .env
    host="${rdsInstance.address}"
    user="${rdsInstance.username}",
    dbname="${rdsInstance.dbName}"
    password="${rdsInstance.password}"
    port="${rdsInstance.port}"
    db_dialect="${rdsInstance.engine}"
    
    # Edit the key-value pairs
    echo "HOST=$host" > .env
    echo "DATABASE_USER=$user" >> .env
    echo "DATABASE_NAME=$dbname" >> .env
    echo "DATABASE_PASSWORD=$password" >> .env
    echo "DATABASE_PORT=$port" >> .env
    `,
    instanceType: "t2.micro",
    vpcSecurityGroupIds: [securityGroup.id],
    associatePublicIpAddress: true,
    subnetId: publicSubnets[0].id,
    keyName: "ec2-key",
    tags: { Name: instanceName },
    rootBlockDevice: {
      volumeSize: 25,
      volumeType: "gp2",
      deleteOnTermination: true,
    },
  });
});