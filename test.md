# Workspace kb1 API 测试脚本（Windows PowerShell）

```powershell
# 查询接口示例：传入 JSON body
Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:9621/api/workspaces/kb1/query" `
  -Headers @{ "Content-Type" = "application/json" } `
  -Body (@{
      query = "who is SuperAdmin"
      mode  = "mix"
    } | ConvertTo-Json)

# 文档查询（分页示例）
Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:9621/api/workspaces/kb1/documents/paginated" `
  -Headers @{ "Content-Type" = "application/json" } `
  -Body (@{
      status_filter = $null
      page = 1
      page_size = 10
      sort_field = "created_at"
      sort_direction = "desc"
    } | ConvertTo-Json)
```
