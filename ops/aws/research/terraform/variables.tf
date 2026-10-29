variable "research_image" {
  type        = string
  description = "Published AWS research image, including registry and digest. Never a mutable tag."
  validation {
    condition     = can(regex("^352329340196[.]dkr[.]ecr[.]ap-southeast-2[.]amazonaws[.]com/acquire-acquire-develop@sha256:[a-f0-9]{64}$", var.research_image))
    error_message = "Use a digest in the existing UAT ECR repository."
  }
}
variable "reader_image" {
  type        = string
  description = "Published Crawl4AI image, including registry and digest."
  validation {
    condition     = can(regex("^352329340196[.]dkr[.]ecr[.]ap-southeast-2[.]amazonaws[.]com/acquire-acquire-develop@sha256:[a-f0-9]{64}$", var.reader_image))
    error_message = "Use a digest in the existing UAT ECR repository."
  }
}
