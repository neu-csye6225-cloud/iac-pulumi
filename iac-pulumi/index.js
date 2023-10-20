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

  const ec2Inst = new aws.ec2.Instance(instanceName, {
    ami:aws.ec2.getAmi({
      owners: [owner],
      mostRecent: true,
      filters: [{ name: "state", values: ["available"] }],
    }).then((ami) => ami.id),
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

 
