const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");

const vpcCidrBlock = "10.0.0.0/16";

const vpc = new aws.ec2.Vpc("my-vpc", {
    cidrBlock: vpcCidrBlock,
});

const igw = new aws.ec2.InternetGateway("my-igw", {
    vpcId: vpc.id,
});

const publicRouteTable = new aws.ec2.RouteTable("public-route-table", {
    vpcId: vpc.id,
});

const privateRouteTable = new aws.ec2.RouteTable("private-route-table", {
    vpcId: vpc.id,
});

const azs = aws.getAvailabilityZones();

const calculateCidrBlock = (baseCidrBlock, index, subnetType) => {
    const subnetNumber = subnetType === "public" ? index * 2 : index * 2 + 1;
    const subnetMask = 24; // Use /24 subnet mask for your subnets
    const baseParts = baseCidrBlock.split('/');
    const baseIpAddress = baseParts[0];
    return `${baseIpAddress}.${subnetNumber}.0/${subnetMask}`;
};

azs.then(az => {
    const maxSubnets = 6;
    let subnetCount = 0;

    az.names.forEach((zoneName, azIndex) => {
        if (subnetCount >= maxSubnets) return;

        let subnetsToCreate;

        if (az.names.length <= 2) {
            subnetsToCreate = azIndex === 0 ? 4 : 2;
        } else {
            subnetsToCreate = 2;
        }

        for (let i = 0; i < subnetsToCreate; i++) {
            if (subnetCount >= maxSubnets) break;

            const subnetType = i % 2 === 0 ? "public" : "private";
            const routeTable = subnetType === "public" ? publicRouteTable : privateRouteTable;
            const subnetName = `${subnetType}-subnet-${subnetCount}`;

            const subnet = new aws.ec2.Subnet(subnetName, {
                vpcId: vpc.id,
                availabilityZone: zoneName,
                cidrBlock: calculateCidrBlock(vpcCidrBlock, subnetCount, subnetType),
                mapPublicIpOnLaunch: subnetType === "public",
            });

            new aws.ec2.RouteTableAssociation(`${subnetType}-rta-${subnetCount}`, {
                subnetId: subnet.id,
                routeTableId: routeTable.id,
            });

            subnetCount++;
        }
    });
});

const publicRoute = new aws.ec2.Route("public-route", {
    routeTableId: publicRouteTable.id,
    destinationCidrBlock: "0.0.0.0/0",
    gatewayId: igw.id,
});

exports.vpcId = vpc.id;
