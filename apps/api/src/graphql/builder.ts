import SchemaBuilder from '@pothos/core';
import type { GQLContext } from './context.js';

/**
 * Pothos SchemaBuilder — single instance shared across all type/resolver files.
 * The `Scalars.Date` entry teaches Pothos that our custom Date scalar
 * accepts/returns native Date objects.
 */
export const builder = new SchemaBuilder<{
  Context: GQLContext;
  Scalars: {
    Date: { Input: Date; Output: Date };
  };
}>({});
