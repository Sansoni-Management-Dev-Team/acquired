output "research" {
  value = {
    cluster              = data.aws_ecs_cluster.existing.cluster_name
    service              = aws_ecs_service.research.name
    base_task_definition = aws_ecs_task_definition.research.arn
    private_url          = "http://research.acquire.internal:8787"
    secret_arn           = aws_secretsmanager_secret.research.arn
    database_endpoint    = data.aws_rds_cluster.app.endpoint
    database_name        = "acquire_research_uat"
    database_marker      = "acquire-research-aws-uat-only"
    initial_task_count   = 0
  }
}
