/**
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { from, Observable } from 'rxjs';
import { map, mergeMap } from 'rxjs/operators';

import { CustomVariableSupport, DataQueryRequest, DataQueryResponse } from '@grafana/data';

import CloudLoggingVariableFindQuery from './CloudLoggingVariableFindQuery';
import { CloudLoggingVariableQueryEditor } from './VariableQueryEditor';
import { DataSource } from './datasource';
import { CloudLoggingVariableQuery } from './types';

export class CloudLoggingVariableSupport extends CustomVariableSupport<
    DataSource,
    CloudLoggingVariableQuery
> {
    private readonly logVarFindQuery: CloudLoggingVariableFindQuery;

    constructor(private readonly datasource: DataSource) {
        super();
        this.logVarFindQuery = new CloudLoggingVariableFindQuery(datasource);
        this.query = this.query.bind(this);
    }

    editor = CloudLoggingVariableQueryEditor;

    query(request: DataQueryRequest<CloudLoggingVariableQuery>): Observable<DataQueryResponse> {
        const executeObservable = from(this.logVarFindQuery.execute(request.targets[0]));
        return from(this.datasource.ensureGCEDefaultProject()).pipe(
            mergeMap(() => executeObservable),
            map((data) => ({ data }))
        );
    }
}
