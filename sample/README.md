#  Monitoring Dashboard Samples

This directory contains sample dashboards for the plugin.

## How to use the samples

- Update the project variable `<Google Cloud Project Id>` in the JSON file.
- Follow the [import steps](https://grafana.com/docs/grafana/latest/dashboards/manage-dashboards/#import-a-dashboard) to upload the JSON to Grafana.
- Create or configure the data sources as needed, such as [Cloud Logging](https://grafana.com/grafana/plugins/googlecloud-logging-datasource/) and [Cloud Monitoring](https://grafana.com/grafana/plugins/stackdriver/).
- If data doesn't show up, you can edit the individual panels and make sure the query and its parameters are correct.

| Dashboard |  Screenshot |
|---|---|
| [GKE Container Log Dashboard](./gke_container_logs.json)|[gke_container_logs.png](./gke_container_logs.png) |
| [Container Error Warning Log Dashboard](./container_error_warning_logs.json)|[container_error_warning_logs.png](./container_error_warning_logs.png) |