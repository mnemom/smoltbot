{{/*
Expand the name of the chart.
*/}}
{{- define "mnemom-gateway.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to
this length (by the DNS naming spec). If the release name contains the chart
name it will not be duplicated.
*/}}
{{- define "mnemom-gateway.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "mnemom-gateway.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "mnemom-gateway.labels" -}}
helm.sh/chart: {{ include "mnemom-gateway.chart" . }}
{{ include "mnemom-gateway.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "mnemom-gateway.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mnemom-gateway.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use.
*/}}
{{- define "mnemom-gateway.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "mnemom-gateway.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Return the image reference (repository:tag).
*/}}
{{- define "mnemom-gateway.image" -}}
{{- $tag := default .Chart.AppVersion .Values.image.tag -}}
{{- printf "%s:%s" .Values.image.repository $tag }}
{{- end }}

{{/*
Return the secret name to use for sensitive env vars.
*/}}
{{- define "mnemom-gateway.secretName" -}}
{{- if .Values.secrets.existingSecret }}
{{- .Values.secrets.existingSecret }}
{{- else }}
{{- include "mnemom-gateway.fullname" . }}
{{- end }}
{{- end }}

{{/*
Return the configmap name.
*/}}
{{- define "mnemom-gateway.configmapName" -}}
{{- include "mnemom-gateway.fullname" . }}
{{- end }}
