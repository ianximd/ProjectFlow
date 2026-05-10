@echo off
for %%f in (
  "infra\sql\procedures\usp_Workspace_Create.sql"
  "infra\sql\procedures\usp_Workspace_List.sql"
  "infra\sql\procedures\usp_Workspace_GetById.sql"
  "infra\sql\procedures\usp_WorkspaceMember_Add.sql"
  "infra\sql\procedures\usp_Project_Create.sql"
  "infra\sql\procedures\usp_Project_List.sql"
  "infra\sql\procedures\usp_Project_GetById.sql"
  "infra\sql\procedures\usp_Sprint_Create.sql"
  "infra\sql\procedures\usp_Sprint_List.sql"
  "infra\sql\procedures\usp_Sprint_Start.sql"
  "infra\sql\procedures\usp_Sprint_Complete.sql"
) do (
  echo Deploying %%f ...
  type %%f | docker exec -i projectmanager-sqlserver-1 /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P YourStrong@Passw0rd -C -d ProjectFlow
)
echo Done.
