{{/* Common helpers for the Scout chart. */}}

{{- define "scout.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "scout.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "scout.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "scout.labels" -}}
helm.sh/chart: {{ include "scout.chart" . }}
{{ include "scout.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "scout.selectorLabels" -}}
app.kubernetes.io/name: {{ include "scout.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "scout.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "scout.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "scout.workerIdentity" -}}
{{- $prefix := . | trunc 56 | trimSuffix "-" -}}
{{- $name := printf "%s-worker" $prefix -}}
{{- if eq $name . -}}
{{- printf "%s-runner" $prefix -}}
{{- else -}}
{{- $name -}}
{{- end -}}
{{- end -}}

{{- define "scout.workerName" -}}
{{- include "scout.workerIdentity" (include "scout.fullname" .) -}}
{{- end -}}

{{- define "scout.workerSelectorLabels" -}}
app.kubernetes.io/name: {{ include "scout.workerIdentity" (include "scout.name" .) }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: worker
{{- end -}}

{{- define "scout.workerNodeHeapMb" -}}
{{- include "scout.nodeHeapMb" (dict "Values" .Values.worker) -}}
{{- end -}}

{{/* Image refs */}}

{{- define "scout.runnerImage" -}}
{{- $tag := .Values.image.tag | default .Chart.AppVersion -}}
{{- printf "%s:%s" .Values.image.repository $tag -}}
{{- end -}}

{{/* Node old-space heap cap (MB). Node sizes its heap to about 55% of the
     container memory limit; deriving ~80% of resources.limits.memory leaves
     headroom for non-heap RSS while using more of the limit. Honours an explicit
     nodeMaxOldSpaceSizeMb override. Renders empty (→ no NODE_OPTIONS, Node's
     own sizing) when no integer Gi/Mi limit is set. */}}
{{- define "scout.nodeHeapMb" -}}
{{- if .Values.nodeMaxOldSpaceSizeMb -}}
{{- .Values.nodeMaxOldSpaceSizeMb -}}
{{- else if and .Values.resources.limits .Values.resources.limits.memory -}}
{{- $mem := .Values.resources.limits.memory | toString -}}
{{- if hasSuffix "Gi" $mem -}}
{{- div (mul (atoi (trimSuffix "Gi" $mem)) 1024 4) 5 -}}
{{- else if hasSuffix "Mi" $mem -}}
{{- div (mul (atoi (trimSuffix "Mi" $mem)) 4) 5 -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/* Bundled PostgreSQL resource and credential names. */}}

{{- define "scout.postgresqlIdentity" -}}
{{- $name := printf "%s-postgresql" (. | trunc 41 | trimSuffix "-") -}}
{{- if eq $name . -}}
{{- printf "%s-database" (. | trunc 43 | trimSuffix "-") -}}
{{- else -}}
{{- $name -}}
{{- end -}}
{{- end -}}

{{- define "scout.postgresqlName" -}}
{{- include "scout.postgresqlIdentity" (include "scout.fullname" .) -}}
{{- end -}}

{{- define "scout.postgresqlSelectorLabels" -}}
app.kubernetes.io/name: {{ include "scout.postgresqlIdentity" (include "scout.name" .) }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: postgresql
{{- end -}}

{{- define "scout.postgresqlHeadlessServiceName" -}}
{{- printf "%s-hl" (include "scout.postgresqlName" . | trunc 60 | trimSuffix "-") -}}
{{- end -}}

{{- define "scout.postgresqlSecretName" -}}
{{- default (include "scout.postgresqlName" .) .Values.postgresql.auth.existingSecret -}}
{{- end -}}

{{- define "scout.postgresqlImage" -}}
{{- $image := .Values.postgresql.image -}}
{{- if $image.digest -}}
{{- printf "%s/%s@%s" $image.registry $image.repository $image.digest -}}
{{- else -}}
{{- printf "%s/%s:%s" $image.registry $image.repository $image.tag -}}
{{- end -}}
{{- end -}}

{{- define "scout.databaseUser" -}}
{{- if .Values.postgresql.enabled -}}
{{- .Values.postgresql.auth.username -}}
{{- else -}}
{{- .Values.database.user -}}
{{- end -}}
{{- end -}}

{{- define "scout.databaseName" -}}
{{- if .Values.postgresql.enabled -}}
{{- .Values.postgresql.auth.database -}}
{{- else -}}
{{- .Values.database.name -}}
{{- end -}}
{{- end -}}

{{- define "scout.validateDatabase" -}}
{{- if and .Values.postgresql.enabled .Values.database.host -}}
{{- fail "Choose one database: set postgresql.enabled=true to run the bundled PostgreSQL, or set database.host to use your own. Both are set." -}}
{{- else if and (not .Values.postgresql.enabled) (not .Values.database.host) -}}
{{- fail "Choose a database: set postgresql.enabled=true to run the bundled PostgreSQL, or set database.host to use your own. Neither is set." -}}
{{- end -}}
{{- end -}}

{{- define "scout.validateAdmins" -}}
{{- if and (not .Values.auth.admins) (not .Values.auth.adminGroup) -}}
{{- fail "Set auth.admins to your admins' email addresses, or auth.adminGroup to a group in your sign-in provider." -}}
{{- end -}}
{{- end -}}

{{- define "scout.databasePasswordSecretName" -}}
{{- include "scout.validateDatabase" . -}}
{{- if .Values.postgresql.enabled -}}
{{- include "scout.postgresqlSecretName" . -}}
{{- else -}}
{{- required "Set database.passwordSecretRef.name to the Secret that holds your database password." .Values.database.passwordSecretRef.name -}}
{{- end -}}
{{- end -}}

{{- define "scout.databasePasswordSecretKey" -}}
{{- if .Values.postgresql.enabled -}}
{{- .Values.postgresql.auth.passwordKey -}}
{{- else -}}
{{- .Values.database.passwordSecretRef.key -}}
{{- end -}}
{{- end -}}

{{/* Database host: bundled Service when enabled, explicit when external. */}}

{{- define "scout.databaseHost" -}}
{{- if .Values.postgresql.enabled -}}
{{- include "scout.postgresqlName" . -}}
{{- else -}}
{{- .Values.database.host -}}
{{- end -}}
{{- end -}}

{{/* DATABASE_URL with $(POSTGRES_PASSWORD) for container environment expansion. */}}

{{- define "scout.databaseUrl" -}}
{{- printf "postgres://%s:$(POSTGRES_PASSWORD)@%s:%d/%s" (include "scout.databaseUser" .) (include "scout.databaseHost" .) (ternary 5432 (int .Values.database.port) .Values.postgresql.enabled) (include "scout.databaseName" .) -}}
{{- if and (not .Values.postgresql.enabled) .Values.database.sslMode -}}
{{- printf "?sslmode=%s" .Values.database.sslMode -}}
{{- end -}}
{{- end -}}
