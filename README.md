# Google Cloud Logging Data Source

## Overview

The Google Cloud Logging Data Source is a backend data source plugin for Grafana,
which allows users to query and visualize their Google Cloud logs in Grafana.

## Setup

### Download

Download this plugin to the machine Grafana is running on, either using `git clone` or simply downloading it as a ZIP file. For the purpose of this guide, we'll assume the user "alice" has downloaded it into their local directory "/Users/alice/grafana/". If you are running the Grafana server using a user such as `grafana`, make sure the user has access to the directory.

### Build the plugin

If you download the source, you need to build the plugin. Make sure you have all the prerequisites installed and configured:

- Grafana 9.0
- Go 1.16+
- Mage
- NodeJS
- yarn

Under the source directory, run the following commands:

```bash
yarn install
yarn build

#Run the following to update Grafana plugin SDK for Go dependency to the latest minor version:

go get -u github.com/grafana/grafana-plugin-sdk-go
go mod tidy

#Build backend plugin binaries for Linux, Windows and Darwin to dist directory:
mage -v
```

More details, please read [the doc](https://grafana.com/tutorials/build-a-data-source-backend-plugin/).
### Grafana Configuration

To have Grafana detect this plugin and make it available for use, two entries must be modified in the Grafana config file. See [Grafana's Documentation](https://grafana.com/docs/grafana/v9.0/setup-grafana/configure-grafana/) for more details, including the default location of the config file depending on platform.

First, set `paths.plugins` to point to where this repo has been downloaded locally. The final build artifacts will be under the `dist` directory:

```ini
[paths]
plugins = /Users/alice/grafana/googlecloud-logging-datasource/dist
```

Next, update `plugins.allow_loading_unsigned_plugins` so that this plugin's ID is in the list:

```ini
[plugins]
allow_loading_unsigned_plugins = googlecloud-logging-datasource
```

With these settings updated, we can now restart Grafana and expect the plugin to be available. The specific command to restart Grafana will depend on what platform it's running on, with the various options documented by [Grafana](https://grafana.com/docs/grafana/v9.0/setup-grafana/restart-grafana/).

## Configuration

1. With Grafana restarted, navigate to `Configuration -> Data sources` (or the route `/datasources`)
2. Click "Add data source"
3. Select "Google Cloud Logging"
4. Provide credentials in a JWT file, either by using the file selector or pasting the contents of the file.
5. Click "Save & test" to test that logs can be queried from Cloud Logging.

## Licenses

Cloud Logging Logo (`src/img/logo.svg`) is from Google Cloud's [Official icons and sample diagrams](https://cloud.google.com/icons)

As commented, `JWTForm` and `JWTConfigEditor` are largely based on Apache-2.0 licensed [grafana-google-sdk-react](https://github.com/grafana/grafana-google-sdk-react/)
