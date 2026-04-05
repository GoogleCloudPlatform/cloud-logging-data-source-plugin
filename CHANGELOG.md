# Changelog
## 1.6.3 (2026-04-05)
* Add Project List Filter to restrict which projects appear in dropdowns using regex patterns
* Add Log Bucket Filter with include/exclude support — prefix patterns with `!` to exclude matching buckets (e.g., `!.*/_Default` to hide Default buckets)
* Fix race condition in variable query where default project could be unresolved before bucket/view queries run

## 1.6.2 (2026-03-18)
* Fix project dropdown search failing with "contains global restriction" error
* Fix `useEffect` dependency causing excessive API calls for log buckets and views
* Fix log views being fetched before buckets have loaded, causing errors for projects without the default bucket
* Return error responses as JSON so Grafana displays actual error messages instead of generic "Unexpected error"
* Suppress duplicate error toast notifications — errors now only appear in the inline alert
* Fix inline error alert showing raw JSON instead of the error message text

## 1.6.1 (2026-03-15)
* Improve the project dropdown performance
* Fix a few minor issues

## 1.6.0 (2026-03-09)
* Fix authentication bug where access token auth could fail (#151)
* Fix project dropdown only showing limited results (#144)
* Sanitize HTML error messages for invalid universe domain configuration
* Narrow HTML detection regex to avoid false positives from Go error messages
* Disable browser autocomplete on sensitive configuration fields
* Update build tooling from grafana-toolkit
* Update OpenTelemetry SDK and other dependencies

## 1.5.2 (2026-01-08)
* Add OAuth Passthrough authentication support - allows users to authenticate using their Grafana Google OAuth token
* Requires Grafana to be configured with Google authentication including the `https://www.googleapis.com/auth/logging.read` scope

## 1.5.1 (2025-08-14)
* Added pagination to ListProjects

## 1.5.0 (2025-05-29)
* Update plugin to support access token auth
* Add datasource syncer
* Fix message from jsonPayload doesn't show up in Grafana
* Update a few dependencies

## 1.4.1 (2024-03-22)
* Fix an encoding issue for parentheses
* Fix cloud logging link scope issue
* Add annotation support
* Update a few dependencies

## 1.4.0 (2023-09-26)
* Support service account impersonation
* Update README for alerting

## 1.3.0 (2023-07-12)

* Map default log level from debug to info
* Add trace info
* Correctly display protoPayload (#38)
* Support log scope variables (#32)
  
## 1.2.1 (2023-05-05)

* Support log scope (need [roles/logging.viewAccessor](https://cloud.google.com/logging/docs/access-control#logging.viewAccessor))
* Fix httpRequest
  
## 1.2.0 (2023-03-17)

* Support GCE service account
* Support field-based filters in Explore page
* Interpolate variables in queries
* Correctly extract label/value pairs from structs
* Added a sample dashboard
  
## 1.1.1 (2023-02-03)

* Move hide logic to datasource.ts filter and reuse client for test connection
* Update dependencies in package.json

## 1.1.0 (2023-01-26)

* Adds Cloud Logging Service Endpoint to configuration
* Fixes hide not working for Cloud Logging query
* Fixes inability to retrieve projects displaying an error

## 1.0.0 (2023-01-17)

Initial release.
