mock_provider "aws" {
  mock_data "aws_vpc" { defaults = { cidr_block = "10.4.0.0/16" } }
  mock_data "aws_subnet" { defaults = { vpc_id = "vpc-094cec961e54f87f0", map_public_ip_on_launch = false } }
  mock_data "aws_rds_cluster" { defaults = { vpc_security_group_ids = ["sg-00a88c23e85849c21"] } }
}
variables {
  research_image = "352329340196.dkr.ecr.ap-southeast-2.amazonaws.com/acquire-acquire-develop@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  reader_image   = "352329340196.dkr.ecr.ap-southeast-2.amazonaws.com/acquire-acquire-develop@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}
run "initial_provisioning_does_not_start_a_worker" {
  command = plan
  assert {
    condition     = aws_ecs_service.research.desired_count == 0 && !aws_ecs_service.research.network_configuration[0].assign_public_ip
    error_message = "Provision privately at zero tasks; database preparation is separate."
  }
  assert {
    condition     = aws_ecs_service.research.deployment_maximum_percent == 100 && aws_ecs_service.research.deployment_minimum_healthy_percent == 0
    error_message = "Do not overlap singleton workers."
  }
  assert {
    condition     = length(local.containers) == 4 && local.containers[0].image == var.research_image && local.containers[2].image == var.reader_image
    error_message = "The task must contain the published worker/relay/reader and pinned search image."
  }
}
