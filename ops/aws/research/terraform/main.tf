locals {
  name     = "acquire-research-develop"
  vpc_id   = "vpc-094cec961e54f87f0"
  subnets  = ["subnet-0fd4fb5849fc7a48e", "subnet-04b44f77d9daaabdb"]
  app_sg   = "sg-0d604c02417b7e850"
  rds_sg   = "sg-00a88c23e85849c21"
  template = jsondecode(file("${path.module}/../task-definition.example.json"))
  containers = [for c in local.template.containerDefinitions : merge(c, {
    image = c.name == "search" ? c.image : c.name == "reader" ? var.reader_image : var.research_image
    secrets = [for s in try(c.secrets, []) : {
      name      = s.name
      valueFrom = "${aws_secretsmanager_secret.research.arn}:${s.name}::"
    }]
  })]
}
data "aws_vpc" "existing" { id = local.vpc_id }
data "aws_subnet" "private" {
  for_each = toset(local.subnets)
  id       = each.value
}
data "aws_ecs_cluster" "existing" { cluster_name = "acquire-acquire-develop" }
data "aws_rds_cluster" "app" { cluster_identifier = "acquire-acquire-develop" }
data "aws_ecr_repository" "existing" { name = "acquire-acquire-develop" }

resource "aws_cloudwatch_log_group" "research" {
  name              = "/ecs/${local.name}"
  retention_in_days = 14
}
resource "aws_secretsmanager_secret" "research" {
  name                    = local.name
  description             = "UAT research database, service and provider credentials; values managed outside Terraform"
  recovery_window_in_days = 7
  lifecycle { prevent_destroy = true }
}

resource "aws_security_group" "research" {
  name        = local.name
  description = "Private research worker; inbound only from the UAT app"
  vpc_id      = local.vpc_id
}
resource "aws_vpc_security_group_ingress_rule" "app_to_research" {
  security_group_id            = aws_security_group.research.id
  referenced_security_group_id = local.app_sg
  from_port                    = 8787
  to_port                      = 8787
  ip_protocol                  = "tcp"
}
resource "aws_vpc_security_group_ingress_rule" "research_to_rds" {
  security_group_id            = local.rds_sg
  referenced_security_group_id = aws_security_group.research.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "Acquire research UAT checkpoint database"
}
resource "aws_vpc_security_group_egress_rule" "web" {
  for_each          = toset(["80", "443"])
  security_group_id = aws_security_group.research.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = tonumber(each.value)
  to_port           = tonumber(each.value)
  ip_protocol       = "tcp"
}
resource "aws_vpc_security_group_egress_rule" "dns" {
  for_each          = toset(["udp", "tcp"])
  security_group_id = aws_security_group.research.id
  cidr_ipv4         = data.aws_vpc.existing.cidr_block
  from_port         = 53
  to_port           = 53
  ip_protocol       = each.value
}
resource "aws_vpc_security_group_egress_rule" "rds" {
  security_group_id            = aws_security_group.research.id
  referenced_security_group_id = local.rds_sg
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_iam_role" "execution" {
  name = "acquire-research-execution-develop"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect    = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole"
    Condition = { StringEquals = { "aws:SourceAccount" = "352329340196" }, ArnLike = { "aws:SourceArn" = "arn:aws:ecs:ap-southeast-2:352329340196:*" } }
  }] })
}
resource "aws_iam_role_policy" "execution" {
  role = aws_iam_role.execution.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
    { Effect = "Allow", Action = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"], Resource = data.aws_ecr_repository.existing.arn },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.research.arn}:*" },
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = aws_secretsmanager_secret.research.arn }
  ] })
}
resource "aws_iam_role" "task" {
  name               = "acquire-research-task-develop"
  assume_role_policy = aws_iam_role.execution.assume_role_policy
}
resource "aws_iam_role_policy" "exec" {
  role = aws_iam_role.task.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = ["ssmmessages:CreateControlChannel", "ssmmessages:CreateDataChannel", "ssmmessages:OpenControlChannel", "ssmmessages:OpenDataChannel"], Resource = "*"
  }] })
}

resource "aws_service_discovery_private_dns_namespace" "research" {
  name        = "acquire.internal"
  description = "Private Acquire service discovery"
  vpc         = local.vpc_id
}
resource "aws_service_discovery_service" "research" {
  name = "research"
  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.research.id
    routing_policy = "MULTIVALUE"
    dns_records {
      ttl  = 10
      type = "A"
    }
  }
  # Provider6.x drops an empty custom-health block. Explicit1 persists the
  # ECS-managed health registration despite the deprecated threshold argument.
  health_check_custom_config { failure_threshold = 1 }
}
resource "aws_ecs_task_definition" "research" {
  family                   = local.name
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "2048"
  memory                   = "8192"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions    = jsonencode(local.containers)
  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
  lifecycle { create_before_destroy = true }
}
resource "aws_ecs_service" "research" {
  name                               = local.name
  cluster                            = data.aws_ecs_cluster.existing.arn
  task_definition                    = aws_ecs_task_definition.research.arn
  desired_count                      = 0
  launch_type                        = "FARGATE"
  platform_version                   = "1.4.0"
  enable_execute_command             = true
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  wait_for_steady_state              = true
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = local.subnets
    security_groups  = [aws_security_group.research.id]
    assign_public_ip = false
  }
  service_registries { registry_arn = aws_service_discovery_service.research.arn }
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [task_definition, desired_count]
    precondition {
      condition     = alltrue([for s in data.aws_subnet.private : s.vpc_id == local.vpc_id && !s.map_public_ip_on_launch]) && contains(data.aws_rds_cluster.app.vpc_security_group_ids, local.rds_sg)
      error_message = "Existing private subnets and app Aurora security group must match the reviewed UAT VPC."
    }
  }
  depends_on = [aws_iam_role_policy.execution, aws_iam_role_policy.exec, aws_vpc_security_group_ingress_rule.research_to_rds]
}
