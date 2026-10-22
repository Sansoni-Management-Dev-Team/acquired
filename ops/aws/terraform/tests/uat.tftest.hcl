mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "352329340196" }
  }
  mock_data "aws_vpc" {
    defaults = { id = "vpc-094cec961e54f87f0" }
  }
  mock_data "aws_ecs_cluster" {
    defaults = {
      arn          = "arn:aws:ecs:ap-southeast-2:352329340196:cluster/acquire-acquire-develop"
      cluster_name = "acquire-acquire-develop"
    }
  }
  mock_data "aws_lb" {
    defaults = {
      arn      = "arn:aws:elasticloadbalancing:ap-southeast-2:352329340196:loadbalancer/app/acquire-public-develop/27f2b25373cd0055"
      vpc_id   = "vpc-094cec961e54f87f0"
      dns_name = "acquire-public-develop.example"
      zone_id  = "Z1GM3OXH4ZPM65"
    }
  }
  mock_data "aws_lb_listener" {
    defaults = { arn = "arn:aws:elasticloadbalancing:ap-southeast-2:352329340196:listener/app/acquire-public-develop/27f2b25373cd0055/3dce6e255c53a0d5" }
  }
  mock_data "aws_rds_cluster" {
    defaults = { endpoint = "acquire-n8n-develop.cluster-cjaq4yw64sj8.ap-southeast-2.rds.amazonaws.com" }
  }
}

variables {
  initial_app_image = "352329340196.dkr.ecr.ap-southeast-2.amazonaws.com/acquire-acquire-develop@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}

run "uat_starts_stopped_and_isolated" {
  command = plan
  assert {
    condition     = aws_ecs_service.app.desired_count == 0 && aws_ecs_service.app.deployment_maximum_percent == 100 && aws_ecs_service.app.deployment_minimum_healthy_percent == 0
    error_message = "Infrastructure must not start a task or permit overlapping UAT tasks."
  }
  assert {
    condition     = local.environment.RESEARCH_ENABLED == "false" && local.environment.COMMUNICATIONS_RUNTIME_ENABLED == "false" && local.environment.CAMPAIGN_N8N_ENABLED == "false"
    error_message = "First UAT release must not activate provider automation."
  }
  assert {
    condition     = aws_ecs_task_definition.bootstrap.cpu == "512" && aws_ecs_task_definition.bootstrap.memory == "2048" && local.containers[0].command == ["node", "uat-start.mjs"]
    error_message = "Use the reviewed UAT startup guard and valid Fargate allocation."
  }
  assert {
    condition     = local.secret_names == ["DATABASE_URL", "DATABASE_SSL_CA_BASE64", "BETTER_AUTH_SECRET", "APP_READINESS_SECRET"] && aws_secretsmanager_secret.app.recovery_window_in_days == 30
    error_message = "Use isolated secret references, without Terraform-managed values."
  }
}

run "mutable_image_rejected" {
  command = plan
  variables {
    initial_app_image = "352329340196.dkr.ecr.ap-southeast-2.amazonaws.com/acquire-acquire-develop:latest"
  }
  expect_failures = [var.initial_app_image]
}
