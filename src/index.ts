/** Public library surface: compose a container and drive the use cases. */
export { createContainer, type Container, type ContainerOptions } from "./composition.js";
export { createMcpServer, SERVER_VERSION } from "./server.js";
export type { IndexReport } from "./application/index-documents.js";
export type { SearchQuery, SearchDefaults } from "./application/search-documents.js";
export type { EvalReport } from "./application/evaluate-search.js";
export type { ReadRequest, ReadResult } from "./application/read-document.js";
export type { Overview } from "./application/get-overview.js";
export * from "./domain/model.js";
