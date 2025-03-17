import * as env from 'env-var';
import { config } from 'dotenv';

config();

export const TYPESENSE_HOST = env.get('TYPESENSE_HOST').required().asString();
export const TYPESENSE_PORT = env
  .get('TYPESENSE_PORT')
  .required()
  .asPortNumber();
export const TYPESENSE_PROTOCOL = env.get('TYPESENSE_PROTOCOL').asString();

export const TYPESENSE_API_KEY = env
  .get('TYPESENSE_API_KEY')
  .required()
  .asString();
export const SUPABASE_DB_HOST = env
  .get('SUPABASE_DB_HOST')
  .required()
  .asString();

export const SUPABASE_DB_NAME = env
  .get('SUPABASE_DB_NAME')
  .required()
  .asString();

export const SUPABASE_USER_NAME = env
  .get('SUPABASE_USER_NAME')
  .required()
  .asString();

export const SUPABASE_USER_PASSWORD = env
  .get('SUPABASE_USER_PASSWORD')
  .required()
  .asString();
