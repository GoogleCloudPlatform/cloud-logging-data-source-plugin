# Google Cloud Logging Data Source

## Overview

The Google Cloud Logging Data Source is a backend data source plugin for Grafana,
which allows users to query and visualize their Google Cloud logs in Grafana.

![image info](https://github.com/GoogleCloudPlatform/cloud-logging-data-source-plugin/blob/main/src/img/cloud_logging_explore_view.png?raw=true)

## Setup

### Enable Cloud Resource Manager API

You need to enable the resource manager API. Otherwise, your cloud projects will not be displayed in the dropdown menu.

You can follow the steps to enable it:

1. Navigate to the [cloud resource manager API page](https://console.cloud.google.com/apis/library/cloudresourcemanager.googleapis.com) in GCP and select your project
2. Press the `Enable` button

### Generate a JWT file & Assign IAM Permissions

1. If you don't have a GCP project, add a new GCP project [here](https://cloud.google.com/resource-manager/docs/creating-managing-projects#console)
2. Open the [Credentials](https://console.developers.google.com/apis/credentials) page in the Google API Console
3. Click **Create Credentials** then click **Service account**
4. On the Create service account page, enter the Service account details
5. Fill in the `Service account details` and then click `Create and Continue`
6. On the `Grant this service account access to project` section, add the `Logs Viewer` role and `Logs View Accessor` role under `Logging` to the service account. Click `Done`
7. In the next step, click the service account you just created. Under the `Keys` tab and select `Add key` and `Create new key`
8. Choose key type `JSON` and click `Create`. A JSON key file will be created and downloaded to your computer

If you want to access logs in multiple cloud projects, you need to ensure the service account has permission to read logs from all of them.

If you host Grafana on a GCE VM, you can also use the [Compute Engine service account](https://cloud.google.com/compute/docs/access/service-accounts#serviceaccount). You need to make sure the service account has sufficient permissions to access the scopes and logs in all projects.

Similar to [Prometheus data sources on Google Cloud](https://cloud.google.com/stackdriver/docs/managed-prometheus/query#use-serverless), you can also configure a scheduled job to use an OAuth2 access token to view the logs. Please follow the steps in the [data source syncer README](https://github.com/GoogleCloudPlatform/cloud-logging-data-source-plugin/blob/main/datasource-syncer/README.md) to configure it.

### Service account impersonation

You can also configure the plugin to use [service account impersonation](https://cloud.google.com/iam/docs/service-account-impersonation).
You need to ensure the service account used by this plugin has the `iam.serviceAccounts.getAccessToken` permission. This permission is in roles like the [Service Account Token Creator role](https://cloud.google.com/iam/docs/understanding-roles#iam.serviceAccountTokenCreator) (roles/iam.serviceAccountTokenCreator). Also, the service account impersonated
by this plugin needs logging read and project list permissions.

### OAuth Passthrough

You can configure the data source to use the OAuth token of the signed in user to authenticate to Google Cloud Logging. This requires a Grafana instance that is configured with [Google authentication](https://grafana.com/docs/grafana/latest/setup-grafana/configure-access/configure-authentication/google/).

Once Grafana is configured with Google authentication for signing in, ensure that the scopes set in the Grafana configuration include: `https://www.googleapis.com/auth/userinfo.profile`, `https://www.googleapis.com/auth/userinfo.email`, and `https://www.googleapis.com/auth/logging.read`. The latter will allow the signed in user to read Google Cloud Logging data.

You can then configure the data source with the `OAuth Passthrough` authentication method. Ensure that you provide a default project ID otherwise the health-check will fail.

### Grafana Configuration

1. With Grafana restarted, navigate to `Configuration -> Data sources` (or the route `/datasources`)
2. Click "Add data source"
3. Select "Google Cloud Logging"
4. Provide credentials from your JWT file, either by uploading it using the file selector or by pasting its contents directly into the designated field
5. Click "Save & test" to test that logs can be queried from Cloud Logging

![image info](https://github.com/GoogleCloudPlatform/cloud-logging-data-source-plugin/blob/main/src/img/cloud_logging_config.png?raw=true)

### An alternative way to provision the data source

After the plugin is installed, you can define and configure the data source in YAML files as part of Grafana’s provisioning system, similar to [the Google Cloud Monitoring plugin](https://grafana.com/docs/grafana/latest/datasources/google-cloud-monitoring/#provision-the-data-source). For more information about provisioning, and for available configuration options, refer to [Provisioning Grafana](https://grafana.com/docs/grafana/latest/administration/provisioning/#data-sources).

The following YAML is an example.

```yaml
apiVersion: 1

datasources:
  - name: Google Cloud Logging
    type: googlecloud-logging-datasource
    access: proxy
    jsonData:
      authenticationType: gce
```

### Supported variables

The plugin currently supports variables for logging scopes. For example, you can define a project variable and switch between projects. The following screenshot shows an example using project, bucket, and view.

![template variables](https://github.com/GoogleCloudPlatform/cloud-logging-data-source-plugin/blob/main/src/img/template_vars.png?raw=true)

Below is an example of defining a variable for log views.
![define a variable](https://github.com/GoogleCloudPlatform/cloud-logging-data-source-plugin/blob/main/src/img/template_query_vars.png?raw=true)

### Alerting

[Grafana Alerting](https://grafana.com/docs/grafana/latest/alerting/fundamentals/data-source-alerting/) is not directly supported due to how [Logging Query Language](https://cloud.google.com/logging/docs/view/logging-query-language) works on Google Cloud. If you need to create alerts based on logs, consider using [Log-based metrics](https://cloud.google.com/logging/docs/logs-based-metrics) and a [Cloud Monitoring data source](https://grafana.com/docs/grafana/latest/datasources/google-cloud-monitoring/).

## Licenses

Cloud Logging Logo (`src/img/logo.svg`) is from Google Cloud's [Official icons and sample diagrams](https://cloud.google.com/icons)

As commented in the code, `JWTForm` and `JWTConfigEditor` are largely based on the Apache-2.0 licensed [grafana-google-sdk-react](https://github.com/grafana/grafana-google-sdk-react/).
