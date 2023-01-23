# How to Contribute

We'd love to accept your patches and contributions to this project.

## Before you begin

### Sign our Contributor License Agreement

Contributions to this project must be accompanied by a
[Contributor License Agreement](https://cla.developers.google.com/about) (CLA).
You (or your employer) retain the copyright to your contribution; this simply
gives us permission to use and redistribute your contributions as part of the
project.

If you or your current employer have already signed the Google CLA (even if it
was for a different project), you probably don't need to do it again.

Visit <https://cla.developers.google.com/> to see your current agreements or to
sign a new one.

### Review our Community Guidelines

This project follows
[Google's Open Source Community Guidelines](https://opensource.google/conduct/).

## Contribution process

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

### Code Reviews

All submissions, including submissions by project members, require review. We
use GitHub pull requests for this purpose. Consult
[GitHub Help](https://help.github.com/articles/about-pull-requests/) for more
information on using pull requests.
