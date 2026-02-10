# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Stage 1: Build the application
FROM golang:1.26.0-alpine AS buildbase

WORKDIR /app

# Set CGO_ENABLED=0 to build a static binary, essential for distroless images.
ENV CGO_ENABLED=0

ENV GOEXPERIMENT=noboringcrypto
ENV GOFIPS140=latest

COPY go.mod go.sum ./
RUN go mod download
COPY . .

# Build the Go application.
# -ldflags="-s -w" strips debugging information and symbols, reducing binary size.
# The '.' at the end signifies building the package in the current directory.
RUN go build -ldflags="-s -w" -o datasource-syncer .

# Stage 2: Create the final minimal image
# Using a distroless static image for a minimal runtime environment.
# 'nonroot' variant runs the application as a non-root user for better security.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=buildbase /app/datasource-syncer /bin/datasource-syncer
ENTRYPOINT ["/bin/datasource-syncer"]
