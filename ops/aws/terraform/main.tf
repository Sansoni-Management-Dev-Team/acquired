# Integrate this module into the company infrastructure root/state after review.
# It owns only new app resources. Existing network, database and n8n are data sources.
data "aws_caller_identity" "current" {}
data "aws_vpc" "uat" {
  id = "vpc-094cec961e54f87f0"
}
data "aws_ecs_cluster" "uat" {
  cluster_name = "acquire-acquire-develop"
}
data "aws_lb" "uat" {
  name = "acquire-public-develop"
}
data "aws_lb_listener" "https" {
  load_balancer_arn = data.aws_lb.uat.arn
  port              = 443
}
data "aws_route53_zone" "uat" {
  name         = "acquire.pajamaprofits.net."
  private_zone = false
}
data "aws_rds_cluster" "uat" {
  cluster_identifier = "acquire-n8n-develop"
}
data "aws_ecr_repository" "app" {
  name = "acquire-acquire-develop"
}

locals {
  account = "352329340196"
  region  = "ap-southeast-2"
  name    = "acquire-app-develop"
  origin  = "https://app.acquire.pajamaprofits.net"
  db_host = "acquire-n8n-develop.cluster-cjaq4yw64sj8.ap-southeast-2.rds.amazonaws.com"
  tags    = merge(var.tags, { project = "acquire", environment = "develop", component = "app" })
  environment = {
    NODE_ENV                       = "production"
    PORT                           = "3000"
    HOSTNAME                       = "0.0.0.0"
    DATABASE_DRIVER                = "postgres"
    APP_URL                        = local.origin
    NEXT_PUBLIC_APP_URL            = local.origin
    AWS_UAT_DATABASE_HOST          = local.db_host
    AWS_UAT_DATABASE_NAME          = "acquire"
    RESEARCH_ENABLED               = "false"
    COMMUNICATIONS_RUNTIME_ENABLED = "false"
    CAMPAIGN_N8N_ENABLED           = "false"
    TARGET_DATA_PROVIDER           = "fixture"
    OUTREACH_DRAFTING_PROVIDER     = "fixture"
    ALLOW_REAL_PERSONAL_DATA       = "false"
    NEXT_TELEMETRY_DISABLED        = "1"
  }
  secret_names = ["DATABASE_URL", "DATABASE_SSL_CA_BASE64", "BETTER_AUTH_SECRET", "APP_READINESS_SECRET"]
  containers = [{
    name            = "app"
    image           = var.initial_app_image
    essential       = true
    command         = ["node", "uat-start.mjs"]
    stopTimeout     = 120
    portMappings    = [{ containerPort = 3000, hostPort = 3000, protocol = "tcp" }]
    environment     = [for name, value in local.environment : { name = name, value = value }]
    secrets         = [for name in local.secret_names : { name = name, valueFrom = "${aws_secretsmanager_secret.app.arn}:${name}::" }]
    linuxParameters = { initProcessEnabled = true }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app.name
        awslogs-region        = local.region
        awslogs-stream-prefix = "ecs"
      }
    }
    healthCheck = {
      command     = ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health/ready',{headers:{Authorization:'Bearer '+process.env.APP_READINESS_SECRET},signal:AbortSignal.timeout(8000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval    = 30
      timeout     = 10
      retries     = 3
      startPeriod = 60
    }
  }]
}

resource "aws_secretsmanager_secret" "app" {
  name                    = local.name
  description             = "Isolated Acquire UAT app configuration; populate only after exact database review. Values are not Terraform-managed."
  recovery_window_in_days = 30
  tags                    = local.tags
  lifecycle { prevent_destroy = true }
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${local.name}"
  retention_in_days = 14
  tags              = local.tags
}

resource "aws_iam_role" "execution" {
  name = "acquire-app-execution-develop"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "ecs-tasks.amazonaws.com" }
  }] })
  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "secret" {
  name = "app-uat-secret"
  role = aws_iam_role.execution.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = "secretsmanager:GetSecretValue", Resource = aws_secretsmanager_secret.app.arn
  }] })
}

resource "aws_iam_role" "task" {
  name               = "acquire-app-task-develop"
  assume_role_policy = aws_iam_role.execution.assume_role_policy
  tags               = local.tags
}

resource "aws_security_group" "app" {
  name        = local.name
  description = "Acquire UAT app: ingress from existing ALB only"
  vpc_id      = data.aws_vpc.uat.id
  tags        = local.tags
}

resource "aws_vpc_security_group_ingress_rule" "alb_to_app" {
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = "sg-0415eb56126e341f4"
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
  description                  = "Existing UAT ALB to app"
}

resource "aws_vpc_security_group_egress_rule" "app" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
  description       = "UAT outbound via existing NAT; automation remains disabled"
}

resource "aws_vpc_security_group_ingress_rule" "app_to_db" {
  security_group_id            = "sg-00a88c23e85849c21"
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "Isolated UAT app to existing Aurora"
}

resource "aws_lb_target_group" "app" {
  name                 = local.name
  port                 = 3000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = data.aws_vpc.uat.id
  deregistration_delay = 120
  health_check {
    path                = "/api/health"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
  tags = local.tags
}

resource "aws_lb_listener_rule" "app" {
  listener_arn = data.aws_lb_listener.https.arn
  priority     = 200
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
  condition {
    host_header { values = ["app.acquire.pajamaprofits.net"] }
  }
  tags = local.tags
}

resource "aws_route53_record" "app" {
  zone_id = data.aws_route53_zone.uat.zone_id
  name    = "app.acquire.pajamaprofits.net"
  type    = "A"
  alias {
    name                   = data.aws_lb.uat.dns_name
    zone_id                = data.aws_lb.uat.zone_id
    evaluate_target_health = true
  }
}

resource "aws_ecs_task_definition" "bootstrap" {
  family                   = local.name
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "2048"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions    = jsonencode(local.containers)
  skip_destroy             = true
  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
  tags = local.tags
  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == local.account && data.aws_rds_cluster.uat.endpoint == local.db_host && data.aws_lb.uat.vpc_id == data.aws_vpc.uat.id
      error_message = "Provider/account/VPC/Aurora do not match the inspected UAT target."
    }
  }
}

resource "aws_ecs_service" "app" {
  name                               = local.name
  cluster                            = data.aws_ecs_cluster.uat.arn
  task_definition                    = aws_ecs_task_definition.bootstrap.arn
  launch_type                        = "FARGATE"
  platform_version                   = "1.4.0"
  desired_count                      = 0
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  health_check_grace_period_seconds  = 90
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = ["subnet-0fd4fb5849fc7a48e", "subnet-04b44f77d9daaabdb"]
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = 3000
  }
  tags       = local.tags
  depends_on = [aws_lb_listener_rule.app, aws_iam_role_policy_attachment.execution, aws_iam_role_policy.secret]
  lifecycle {
    prevent_destroy = true
    # Infrastructure owns topology and the reviewed base config; release CI owns these fields.
    ignore_changes = [task_definition, desired_count]
  }
}
