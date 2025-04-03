import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
// Testing OIDC Authentication

// -------------------- S3 Static Website Setup --------------------

// Create an S3 bucket with website hosting enabled
const bucket = new aws.s3.Bucket("my-static-site", {
    website: {
        indexDocument: "index.html",
        errorDocument: "error.html",
    },
});

// **Disable Block Public Access (Allow public bucket policy)**
const publicAccessBlock = new aws.s3.BucketPublicAccessBlock("disablePublicAccess", {
    bucket: bucket.id,
    blockPublicAcls: false,
    blockPublicPolicy: false,  // Allow public policies
    restrictPublicBuckets: false,  
    ignorePublicAcls: false
});

// Upload the index.html file
const indexHtml = new aws.s3.BucketObject("index", {
    bucket: bucket,
    source: new pulumi.asset.FileAsset("index.html"), // Ensure this file exists
    contentType: "text/html",
});

// **Apply a public bucket policy after disabling block public access**
const bucketPolicy = new aws.s3.BucketPolicy("bucketPolicy", {
    bucket: bucket.id,
    policy: pulumi.all([bucket.id, publicAccessBlock.id]).apply(([id]) => JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Effect: "Allow",
            Principal: "*",
            Action: "s3:GetObject",
            Resource: `arn:aws:s3:::${id}/*`,
        }],
    })),
});

// Export the website URL
export const bucketName = bucket.bucket;
export const websiteUrl = bucket.websiteEndpoint;

// -------------------- ECS with OIDC Authentication --------------------

// Create a VPC
const vpc = new aws.ec2.Vpc("my-vpc", {
    cidrBlock: "10.0.0.0/16",
    enableDnsSupport: true,
    enableDnsHostnames: true,
});

// Create a subnet
const subnet = new aws.ec2.Subnet("my-subnet", {
    vpcId: vpc.id,
    cidrBlock: "10.0.1.0/24",
    availabilityZone: "us-east-1a",
    mapPublicIpOnLaunch: false,
});

// Create a Security Group
const securityGroup = new aws.ec2.SecurityGroup("my-sg", {
    vpcId: vpc.id,
    egress: [{
        cidrBlocks: ["0.0.0.0/0"],
        fromPort: 0,
        toPort: 0,
        protocol: "-1", // Allow all outbound traffic
    }],
    ingress: [{
        cidrBlocks: ["0.0.0.0/0"],
        fromPort: 80,
        toPort: 80,
        protocol: "tcp",
    }],
});

// Create an ECS Cluster
const cluster = new aws.ecs.Cluster("my-cluster");

// IAM role for ECS tasks using OIDC (OpenID Connect)
const role = new aws.iam.Role("my-ecs-task-role", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: {
          Federated: "arn:aws:iam::597088046551:oidc-provider/token.actions.githubusercontent.com"
        },
        Action: "sts:AssumeRoleWithWebIdentity",
        Condition: {
          StringEquals: {
            "token.actions.githubusercontent.com:sub": "repo:Lalithachennapragada/Pulumi-Lab8-Lalitha:ref:refs/heads/main"
          }
        }
      }
    ]
  }),
});

// Attach policies to the role
const policyAttachment = new aws.iam.RolePolicyAttachment("my-ecs-policy-attachment", {
  role: role,
  policyArn: "arn:aws:iam::aws:policy/AmazonECS_FullAccess",
});

// Create a minimal ECS Task Definition
const taskDefinition = new aws.ecs.TaskDefinition("my-task-definition", {
  family: "my-task",
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"], // Required for Fargate
  executionRoleArn: role.arn,
  taskRoleArn: role.arn,
  cpu: "256",
  memory: "512",
  containerDefinitions: JSON.stringify([{
    name: "placeholder-container",
    image: "amazon/amazonlinux",  // ✅ Minimal container (not used)
    memory: 512,
    cpu: 256,
    essential: true,
    command: ["/bin/sh", "-c", "while true; do sleep 30; done"]  // Keeps container running
  }]),
});

// Create an ECS Service
const service = new aws.ecs.Service("my-ecs-service", {
  cluster: cluster.id,
  taskDefinition: taskDefinition.arn,  // ✅ Link the Task Definition
  desiredCount: 1,
  launchType: "FARGATE", // ✅ Required for Fargate
  networkConfiguration: {
    assignPublicIp: true,
    subnets: [subnet.id],
    securityGroups: [securityGroup.id],
  },
});


// Export ECS service details
export const clusterName = cluster.name;
export const serviceName = service.name;
export const oidcRoleArn = role.arn;
