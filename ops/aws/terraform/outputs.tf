output "release_config" {
  description = "Non-secret JSON for GitHub environment variable ACQUIRE_UAT_RELEASE_CONFIG. Refresh after changing Terraform base task config."
  value = {
    schemaVersion      = 1
    accountId          = local.account
    region             = local.region
    cluster            = data.aws_ecs_cluster.uat.cluster_name
    service            = aws_ecs_service.app.name
    origin             = local.origin
    repository         = data.aws_ecr_repository.app.repository_url
    baseTaskDefinition = aws_ecs_task_definition.bootstrap.arn
    secretArn          = aws_secretsmanager_secret.app.arn
  }
}

output "secret_field_names" {
  value = local.secret_names
}
