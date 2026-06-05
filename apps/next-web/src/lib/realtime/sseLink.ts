'use client';

import { ApolloLink, Observable } from '@apollo/client';
import { type Client, type ClientOptions, createClient } from 'graphql-sse';
import { print } from 'graphql';

/**
 * Apollo Link that drives GraphQL subscriptions over Server-Sent Events using graphql-sse.
 *
 * Apollo Client 4 restructured its API relative to the 3.x recipes:
 *  - `Observable` re-exported from `@apollo/client` is now RxJS's `Observable` (the
 *    subscriber/sink still exposes `next`/`error`/`complete`, so the recipe shape holds).
 *  - `ApolloLink.request` is typed with the namespaced `ApolloLink.Operation` input and
 *    returns `Observable<ApolloLink.Result>` (the 3.x `Operation`/`FetchResult` were renamed).
 * We use those namespaced types so this type-checks against the installed 4.x surface.
 */
export class SSELink extends ApolloLink {
  private client: Client;

  constructor(options: ClientOptions) {
    super();
    this.client = createClient(options);
  }

  request(operation: ApolloLink.Operation): Observable<ApolloLink.Result> {
    return new Observable<ApolloLink.Result>((sink) =>
      this.client.subscribe<Record<string, unknown>>(
        // Send ONLY the GraphQL request params. Spreading the whole Apollo
        // operation leaks v4-only fields (notably `operation.client`) into the
        // request body, and graphql-yoga rejects unknown params with a 400
        // ("Unexpected parameter \"client\"") — silently breaking every browser
        // subscription (the SSE retry-storms). Pick the four wire fields explicitly.
        {
          operationName: operation.operationName,
          query: print(operation.query),
          variables: operation.variables,
          extensions: operation.extensions,
        },
        {
          // graphql-sse types its sink with graphql-js `ExecutionResult` (whose `errors`
          // are `GraphQLError` class instances), while Apollo 4's `ApolloLink.Result`
          // uses `FormattedExecutionResult` (plain `GraphQLFormattedError`). Over SSE the
          // wire value is always the *formatted* JSON shape, so it already matches what
          // Apollo expects — the single cast here only reconciles the two nominal
          // `ExecutionResult` types at this graphql-sse <-> Apollo-4 boundary.
          next: (value) => sink.next(value as ApolloLink.Result),
          complete: sink.complete.bind(sink),
          error: sink.error.bind(sink),
        },
      ),
    );
  }
}
