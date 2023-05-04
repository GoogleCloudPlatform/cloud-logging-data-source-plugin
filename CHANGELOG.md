# Changelog

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
