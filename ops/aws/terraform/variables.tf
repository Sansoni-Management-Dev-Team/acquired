variable "initial_app_image" {
  description = "Already-published UAT image digest; never use a mutable tag. Terraform creates the service stopped."
  type        = string
  validation {
    condition     = can(regex("^352329340196\\.dkr\\.ecr\\.ap-southeast-2\\.amazonaws\\.com/acquire-acquire-develop@sha256:[a-f0-9]{64}$", var.initial_app_image))
    error_message = "Use the existing Acquire UAT ECR repository and an immutable sha256 digest."
  }
}

variable "tags" {
  description = "Additional company ownership tags. No credentials or secret values."
  type        = map(string)
  default     = {}
}
