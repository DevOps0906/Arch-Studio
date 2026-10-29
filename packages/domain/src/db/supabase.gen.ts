
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "ai_chunks": {
                  Row: {
                    "app_id": string,"chunk_index": number,"collection_id": string,"content": string,"created_at": string,"document_id": string,"embedding": string,"id": number,"metadata": NonNullable<Json>,"org_id": string,"token_count": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "app_id": string,"chunk_index": number,"collection_id": string,"content": string,"created_at"?: string,"document_id": string,"embedding": string,"id"?: never,"metadata"?: NonNullable<Json>,"org_id": string,"token_count"?: number | null
                  }
                  Update: {
                    "app_id"?: string,"chunk_index"?: number,"collection_id"?: string,"content"?: string,"created_at"?: string,"document_id"?: string,"embedding"?: string,"id"?: never,"metadata"?: NonNullable<Json>,"org_id"?: string,"token_count"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_chunks_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_chunks_document_id_org_id_app_id_collection_id_fkey"
      columns: ["document_id","org_id","app_id","collection_id"]
isOneToOne: false
      referencedRelation: "ai_documents"
      referencedColumns: ["id","org_id","app_id","collection_id"]
    },{
      foreignKeyName: "ai_chunks_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_collections": {
                  Row: {
                    "app_id": string,"created_at": string,"created_by": string | null,"embedding_dim": number,"embedding_model": string,"embedding_provider": string,"id": string,"kind": string,"name": string,"org_id": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "app_id": string,"created_at"?: string,"created_by"?: string | null,"embedding_dim"?: number,"embedding_model": string,"embedding_provider": string,"id"?: string,"kind": string,"name": string,"org_id": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "app_id"?: string,"created_at"?: string,"created_by"?: string | null,"embedding_dim"?: number,"embedding_model"?: string,"embedding_provider"?: string,"id"?: string,"kind"?: string,"name"?: string,"org_id"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_collections_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_collections_embedding_provider_fkey"
      columns: ["embedding_provider"]
isOneToOne: false
      referencedRelation: "ai_providers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_collections_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_conversations": {
                  Row: {
                    "app_id": string,"channel": string,"created_at": string,"dify_conversation_id": string | null,"dify_user": string,"id": string,"org_id": string,"status": string,"title": string | null,"updated_at": string,"user_id": string | null,"visitor_key": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "app_id": string,"channel"?: string,"created_at"?: string,"dify_conversation_id"?: string | null,"dify_user": string,"id"?: string,"org_id": string,"status"?: string,"title"?: string | null,"updated_at"?: string,"user_id"?: string | null,"visitor_key"?: string | null
                  }
                  Update: {
                    "app_id"?: string,"channel"?: string,"created_at"?: string,"dify_conversation_id"?: string | null,"dify_user"?: string,"id"?: string,"org_id"?: string,"status"?: string,"title"?: string | null,"updated_at"?: string,"user_id"?: string | null,"visitor_key"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_conversations_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_conversations_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_documents": {
                  Row: {
                    "app_id": string,"byte_size": number | null,"collection_id": string,"contains_pii": boolean,"content_hash": string,"created_at": string,"created_by": string | null,"error": string | null,"id": string,"mime": string | null,"org_id": string,"source_type": string,"source_url": string | null,"status": string,"storage_path": string | null,"title": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "app_id": string,"byte_size"?: number | null,"collection_id": string,"contains_pii"?: boolean,"content_hash": string,"created_at"?: string,"created_by"?: string | null,"error"?: string | null,"id"?: string,"mime"?: string | null,"org_id": string,"source_type": string,"source_url"?: string | null,"status"?: string,"storage_path"?: string | null,"title"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "app_id"?: string,"byte_size"?: number | null,"collection_id"?: string,"contains_pii"?: boolean,"content_hash"?: string,"created_at"?: string,"created_by"?: string | null,"error"?: string | null,"id"?: string,"mime"?: string | null,"org_id"?: string,"source_type"?: string,"source_url"?: string | null,"status"?: string,"storage_path"?: string | null,"title"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_documents_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_documents_collection_id_org_id_app_id_fkey"
      columns: ["collection_id","org_id","app_id"]
isOneToOne: false
      referencedRelation: "ai_collections"
      referencedColumns: ["id","org_id","app_id"]
    },{
      foreignKeyName: "ai_documents_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_messages": {
                  Row: {
                    "citations": NonNullable<Json>,"content": string,"conversation_id": string,"created_at": string,"credit_ledger_id": number | null,"credits": number,"id": number,"input_tokens": number,"model": string | null,"org_id": string,"output_tokens": number,"provider_id": string | null,"role": string
                  }
                  ComputedFields: never
                  Insert: {
                    "citations"?: NonNullable<Json>,"content": string,"conversation_id": string,"created_at"?: string,"credit_ledger_id"?: number | null,"credits"?: number,"id"?: never,"input_tokens"?: number,"model"?: string | null,"org_id": string,"output_tokens"?: number,"provider_id"?: string | null,"role": string
                  }
                  Update: {
                    "citations"?: NonNullable<Json>,"content"?: string,"conversation_id"?: string,"created_at"?: string,"credit_ledger_id"?: number | null,"credits"?: number,"id"?: never,"input_tokens"?: number,"model"?: string | null,"org_id"?: string,"output_tokens"?: number,"provider_id"?: string | null,"role"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_messages_conversation_id_org_id_fkey"
      columns: ["conversation_id","org_id"]
isOneToOne: false
      referencedRelation: "ai_conversations"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "ai_messages_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_messages_provider_id_fkey"
      columns: ["provider_id"]
isOneToOne: false
      referencedRelation: "ai_providers"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_model_prices": {
                  Row: {
                    "created_at": string,"credits_per_unit": number,"id": string,"is_active": boolean,"kind": string,"license": string | null,"model": string,"provider_id": string,"unit": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"credits_per_unit": number,"id"?: string,"is_active"?: boolean,"kind": string,"license"?: string | null,"model"?: string,"provider_id": string,"unit": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"credits_per_unit"?: number,"id"?: string,"is_active"?: boolean,"kind"?: string,"license"?: string | null,"model"?: string,"provider_id"?: string,"unit"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_model_prices_provider_id_fkey"
      columns: ["provider_id"]
isOneToOne: false
      referencedRelation: "ai_providers"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_org_settings": {
                  Row: {
                    "ack_by": string | null,"created_at": string,"cross_border_ack_at": string | null,"cross_border_notice": string | null,"org_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ack_by"?: string | null,"created_at"?: string,"cross_border_ack_at"?: string | null,"cross_border_notice"?: string | null,"org_id": string,"updated_at"?: string
                  }
                  Update: {
                    "ack_by"?: string | null,"created_at"?: string,"cross_border_ack_at"?: string | null,"cross_border_notice"?: string | null,"org_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_org_settings_org_id_fkey"
      columns: ["org_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_providers": {
                  Row: {
                    "created_at": string,"cross_border": boolean,"id": string,"is_active": boolean,"kinds": (string)[],"name": string,"notes": string | null,"source": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"cross_border"?: boolean,"id": string,"is_active"?: boolean,"kinds": (string)[],"name": string,"notes"?: string | null,"source": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"cross_border"?: boolean,"id"?: string,"is_active"?: boolean,"kinds"?: (string)[],"name"?: string,"notes"?: string | null,"source"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"ai_routing_settings": {
                  Row: {
                    "app_id": string | null,"chain": NonNullable<Json>,"created_at": string,"feature": string,"force_open_source": boolean,"id": string,"kind": string,"mode": string,"org_id": string | null,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "app_id"?: string | null,"chain"?: NonNullable<Json>,"created_at"?: string,"feature"?: string,"force_open_source"?: boolean,"id"?: string,"kind": string,"mode"?: string,"org_id"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "app_id"?: string | null,"chain"?: NonNullable<Json>,"created_at"?: string,"feature"?: string,"force_open_source"?: boolean,"id"?: string,"kind"?: string,"mode"?: string,"org_id"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_routing_settings_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_routing_settings_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_run_steps": {
                  Row: {
                    "detail": NonNullable<Json>,"finished_at": string | null,"id": number,"model": string | null,"node": string,"org_id": string,"provider_id": string | null,"run_id": string,"started_at": string,"status": string,"tokens": number
                  }
                  ComputedFields: never
                  Insert: {
                    "detail"?: NonNullable<Json>,"finished_at"?: string | null,"id"?: never,"model"?: string | null,"node": string,"org_id": string,"provider_id"?: string | null,"run_id": string,"started_at"?: string,"status": string,"tokens"?: number
                  }
                  Update: {
                    "detail"?: NonNullable<Json>,"finished_at"?: string | null,"id"?: never,"model"?: string | null,"node"?: string,"org_id"?: string,"provider_id"?: string | null,"run_id"?: string,"started_at"?: string,"status"?: string,"tokens"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_run_steps_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_run_steps_provider_id_fkey"
      columns: ["provider_id"]
isOneToOne: false
      referencedRelation: "ai_providers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_run_steps_run_id_org_id_fkey"
      columns: ["run_id","org_id"]
isOneToOne: false
      referencedRelation: "ai_runs"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"ai_runs": {
                  Row: {
                    "app_id": string,"created_at": string,"created_by": string | null,"credit_ledger_id": number | null,"credits": number,"error": string | null,"finished_at": string | null,"graph": string,"id": string,"input": NonNullable<Json>,"input_tokens": number,"job_id": string | null,"model": string | null,"org_id": string,"output": Json | null,"output_tokens": number,"provider_id": string | null,"started_at": string | null,"status": string,"thread_id": string | null,"trace_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "app_id": string,"created_at"?: string,"created_by"?: string | null,"credit_ledger_id"?: number | null,"credits"?: number,"error"?: string | null,"finished_at"?: string | null,"graph": string,"id"?: string,"input"?: NonNullable<Json>,"input_tokens"?: number,"job_id"?: string | null,"model"?: string | null,"org_id": string,"output"?: Json | null,"output_tokens"?: number,"provider_id"?: string | null,"started_at"?: string | null,"status"?: string,"thread_id"?: string | null,"trace_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "app_id"?: string,"created_at"?: string,"created_by"?: string | null,"credit_ledger_id"?: number | null,"credits"?: number,"error"?: string | null,"finished_at"?: string | null,"graph"?: string,"id"?: string,"input"?: NonNullable<Json>,"input_tokens"?: number,"job_id"?: string | null,"model"?: string | null,"org_id"?: string,"output"?: Json | null,"output_tokens"?: number,"provider_id"?: string | null,"started_at"?: string | null,"status"?: string,"thread_id"?: string | null,"trace_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_runs_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_runs_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_runs_provider_id_fkey"
      columns: ["provider_id"]
isOneToOne: false
      referencedRelation: "ai_providers"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_usage": {
                  Row: {
                    "app_id": string | null,"audio_seconds": number | null,"characters": number | null,"conversation_id": string | null,"cost_usd_micros": number,"created_at": string,"credits": number,"error_code": string | null,"feature": string | null,"id": number,"input_tokens": number,"kind": string,"latency_ms": number | null,"ledger_id": number | null,"model": string,"org_id": string,"output_tokens": number,"provider": string,"purpose": string | null,"request_id": string | null,"run_id": string | null,"settled_at": string | null,"source": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "app_id"?: string | null,"audio_seconds"?: number | null,"characters"?: number | null,"conversation_id"?: string | null,"cost_usd_micros"?: number,"created_at"?: string,"credits"?: number,"error_code"?: string | null,"feature"?: string | null,"id"?: never,"input_tokens"?: number,"kind"?: string,"latency_ms"?: number | null,"ledger_id"?: number | null,"model": string,"org_id": string,"output_tokens"?: number,"provider": string,"purpose"?: string | null,"request_id"?: string | null,"run_id"?: string | null,"settled_at"?: string | null,"source"?: string | null,"status"?: string
                  }
                  Update: {
                    "app_id"?: string | null,"audio_seconds"?: number | null,"characters"?: number | null,"conversation_id"?: string | null,"cost_usd_micros"?: number,"created_at"?: string,"credits"?: number,"error_code"?: string | null,"feature"?: string | null,"id"?: never,"input_tokens"?: number,"kind"?: string,"latency_ms"?: number | null,"ledger_id"?: number | null,"model"?: string,"org_id"?: string,"output_tokens"?: number,"provider"?: string,"purpose"?: string | null,"request_id"?: string | null,"run_id"?: string | null,"settled_at"?: string | null,"source"?: string | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_usage_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_usage_ledger_id_fkey"
      columns: ["ledger_id"]
isOneToOne: false
      referencedRelation: "credit_ledger"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_usage_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"app_entitlements": {
                  Row: {
                    "app_id": string,"created_at": string,"expires_at": string | null,"granted_by": string | null,"note": string | null,"org_id": string,"plan_id": string,"source": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "app_id": string,"created_at"?: string,"expires_at"?: string | null,"granted_by"?: string | null,"note"?: string | null,"org_id": string,"plan_id": string,"source"?: string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "app_id"?: string,"created_at"?: string,"expires_at"?: string | null,"granted_by"?: string | null,"note"?: string | null,"org_id"?: string,"plan_id"?: string,"source"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "app_entitlements_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "app_entitlements_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "app_entitlements_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "plans"
      referencedColumns: ["id"]
    }
                  ]
                },"apps": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"schema_name": string,"signup_policy": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id": string,"name": string,"schema_name": string,"signup_policy"?: string,"status"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"schema_name"?: string,"signup_policy"?: string,"status"?: string
                  }
                  Relationships: [
                    
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"actor_role": string,"after": Json | null,"before": Json | null,"created_at": string,"id": number,"ip": unknown,"metadata": NonNullable<Json>,"org_id": string | null,"request_id": string | null,"target_id": string | null,"target_type": string | null,"user_agent": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"actor_role"?: string,"after"?: Json | null,"before"?: Json | null,"created_at"?: string,"id"?: never,"ip"?: unknown,"metadata"?: NonNullable<Json>,"org_id"?: string | null,"request_id"?: string | null,"target_id"?: string | null,"target_type"?: string | null,"user_agent"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"actor_role"?: string,"after"?: Json | null,"before"?: Json | null,"created_at"?: string,"id"?: never,"ip"?: unknown,"metadata"?: NonNullable<Json>,"org_id"?: string | null,"request_id"?: string | null,"target_id"?: string | null,"target_type"?: string | null,"user_agent"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"billing_keys": {
                  Row: {
                    "billing_key_ciphertext": string,"card_company": string | null,"card_number_masked": string | null,"created_at": string,"created_by": string | null,"customer_key": string,"id": string,"key_version": number,"org_id": string,"revoked_at": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "billing_key_ciphertext": string,"card_company"?: string | null,"card_number_masked"?: string | null,"created_at"?: string,"created_by"?: string | null,"customer_key": string,"id"?: string,"key_version"?: number,"org_id": string,"revoked_at"?: string | null,"status"?: string
                  }
                  Update: {
                    "billing_key_ciphertext"?: string,"card_company"?: string | null,"card_number_masked"?: string | null,"created_at"?: string,"created_by"?: string | null,"customer_key"?: string,"id"?: string,"key_version"?: number,"org_id"?: string,"revoked_at"?: string | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "billing_keys_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"builds": {
                  Row: {
                    "build_date": string,"bytes": number,"channel": string,"created_at": string,"id": string,"notes": string | null,"platform": string,"published_at": string | null,"sha256": string,"signature": string,"status": string,"storage_path": string,"updated_at": string,"version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "build_date": string,"bytes": number,"channel"?: string,"created_at"?: string,"id"?: string,"notes"?: string | null,"platform": string,"published_at"?: string | null,"sha256": string,"signature": string,"status"?: string,"storage_path": string,"updated_at"?: string,"version": string
                  }
                  Update: {
                    "build_date"?: string,"bytes"?: number,"channel"?: string,"created_at"?: string,"id"?: string,"notes"?: string | null,"platform"?: string,"published_at"?: string | null,"sha256"?: string,"signature"?: string,"status"?: string,"storage_path"?: string,"updated_at"?: string,"version"?: string
                  }
                  Relationships: [
                    
                  ]
                },"cloud_projects": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"local_id": string,"name": string,"org_id": string,"storage_path": string,"updated_at": string,"updated_by": string | null,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"local_id": string,"name": string,"org_id": string,"storage_path": string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"local_id"?: string,"name"?: string,"org_id"?: string,"storage_path"?: string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "cloud_projects_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"cost_catalogs": {
                  Row: {
                    "basis_date": string,"created_at": string,"id": string,"items": NonNullable<Json>,"published_at": string | null,"sha256": string,"source_note": string,"status": string,"updated_at": string,"version": string,"withdrawn_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "basis_date": string,"created_at"?: string,"id"?: string,"items": NonNullable<Json>,"published_at"?: string | null,"sha256": string,"source_note": string,"status"?: string,"updated_at"?: string,"version": string,"withdrawn_at"?: string | null
                  }
                  Update: {
                    "basis_date"?: string,"created_at"?: string,"id"?: string,"items"?: NonNullable<Json>,"published_at"?: string | null,"sha256"?: string,"source_note"?: string,"status"?: string,"updated_at"?: string,"version"?: string,"withdrawn_at"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"credit_ledger": {
                  Row: {
                    "actor_id": string | null,"amount": number,"app_id": string | null,"balance_after": number,"created_at": string,"entry_type": string,"id": number,"idempotency_key": string | null,"metadata": NonNullable<Json>,"org_id": string,"pack_delta": number,"plan_delta": number,"reason": string,"ref_id": string | null,"ref_type": string | null,"refund_of": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"amount": number,"app_id"?: string | null,"balance_after": number,"created_at"?: string,"entry_type": string,"id"?: never,"idempotency_key"?: string | null,"metadata"?: NonNullable<Json>,"org_id": string,"pack_delta"?: number,"plan_delta"?: number,"reason": string,"ref_id"?: string | null,"ref_type"?: string | null,"refund_of"?: number | null
                  }
                  Update: {
                    "actor_id"?: string | null,"amount"?: number,"app_id"?: string | null,"balance_after"?: number,"created_at"?: string,"entry_type"?: string,"id"?: never,"idempotency_key"?: string | null,"metadata"?: NonNullable<Json>,"org_id"?: string,"pack_delta"?: number,"plan_delta"?: number,"reason"?: string,"ref_id"?: string | null,"ref_type"?: string | null,"refund_of"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "credit_ledger_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_ledger_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_ledger_refund_of_fkey"
      columns: ["refund_of"]
isOneToOne: false
      referencedRelation: "credit_ledger"
      referencedColumns: ["id"]
    }
                  ]
                },"credit_packs": {
                  Row: {
                    "app_id": string,"code": string,"created_at": string,"credits": number,"id": string,"is_active": boolean,"name": string,"price_krw": number,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "app_id": string,"code": string,"created_at"?: string,"credits": number,"id"?: string,"is_active"?: boolean,"name": string,"price_krw": number,"sort_order"?: number
                  }
                  Update: {
                    "app_id"?: string,"code"?: string,"created_at"?: string,"credits"?: number,"id"?: string,"is_active"?: boolean,"name"?: string,"price_krw"?: number,"sort_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "credit_packs_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    }
                  ]
                },"drafting_profiles": {
                  Row: {
                    "architect_name": string | null,"contact": string | null,"created_at": string,"default_paper": string,"default_text_height_mm": number,"font_family": string,"layer_map": NonNullable<Json>,"logo_storage_path": string | null,"office_name": string,"org_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "architect_name"?: string | null,"contact"?: string | null,"created_at"?: string,"default_paper"?: string,"default_text_height_mm"?: number,"font_family"?: string,"layer_map"?: NonNullable<Json>,"logo_storage_path"?: string | null,"office_name": string,"org_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "architect_name"?: string | null,"contact"?: string | null,"created_at"?: string,"default_paper"?: string,"default_text_height_mm"?: number,"font_family"?: string,"layer_map"?: NonNullable<Json>,"logo_storage_path"?: string | null,"office_name"?: string,"org_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "drafting_profiles_org_id_fkey"
      columns: ["org_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"intake_runs": {
                  Row: {
                    "created_at": string,"created_by": string | null,"credit_ledger_id": number | null,"credits": number,"error": string | null,"expires_at": string,"finished_at": string | null,"id": string,"input_kind": string,"input_text": string | null,"job_id": string | null,"notice_version": string | null,"org_id": string,"project_ref": string,"request_id": string,"result": Json | null,"source": string,"started_at": string | null,"status": string,"stt_job_id": string | null,"updated_at": string,"variant": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"credit_ledger_id"?: number | null,"credits": number,"error"?: string | null,"expires_at"?: string,"finished_at"?: string | null,"id"?: string,"input_kind"?: string,"input_text"?: string | null,"job_id"?: string | null,"notice_version"?: string | null,"org_id": string,"project_ref": string,"request_id": string,"result"?: Json | null,"source": string,"started_at"?: string | null,"status"?: string,"stt_job_id"?: string | null,"updated_at"?: string,"variant": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"credit_ledger_id"?: number | null,"credits"?: number,"error"?: string | null,"expires_at"?: string,"finished_at"?: string | null,"id"?: string,"input_kind"?: string,"input_text"?: string | null,"job_id"?: string | null,"notice_version"?: string | null,"org_id"?: string,"project_ref"?: string,"request_id"?: string,"result"?: Json | null,"source"?: string,"started_at"?: string | null,"status"?: string,"stt_job_id"?: string | null,"updated_at"?: string,"variant"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "intake_runs_credit_ledger_id_fkey"
      columns: ["credit_ledger_id"]
isOneToOne: false
      referencedRelation: "credit_ledger"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "intake_runs_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "intake_runs_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "intake_runs_stt_job_id_fkey"
      columns: ["stt_job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    }
                  ]
                },"jobs": {
                  Row: {
                    "app_id": string,"attempts": number,"created_at": string,"created_by": string | null,"credit_ledger_id": number | null,"finished_at": string | null,"heartbeat_at": string | null,"id": string,"idempotency_key": string | null,"job_type": string,"last_error": string | null,"locked_at": string | null,"locked_by": string | null,"max_attempts": number,"org_id": string,"parent_job_id": string | null,"payload": NonNullable<Json>,"priority": number,"progress": number,"progress_message": string | null,"queue": string,"refund_on_failure": boolean,"result": Json | null,"run_after": string,"started_at": string | null,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "app_id": string,"attempts"?: number,"created_at"?: string,"created_by"?: string | null,"credit_ledger_id"?: number | null,"finished_at"?: string | null,"heartbeat_at"?: string | null,"id"?: string,"idempotency_key"?: string | null,"job_type": string,"last_error"?: string | null,"locked_at"?: string | null,"locked_by"?: string | null,"max_attempts"?: number,"org_id": string,"parent_job_id"?: string | null,"payload"?: NonNullable<Json>,"priority"?: number,"progress"?: number,"progress_message"?: string | null,"queue"?: string,"refund_on_failure"?: boolean,"result"?: Json | null,"run_after"?: string,"started_at"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "app_id"?: string,"attempts"?: number,"created_at"?: string,"created_by"?: string | null,"credit_ledger_id"?: number | null,"finished_at"?: string | null,"heartbeat_at"?: string | null,"id"?: string,"idempotency_key"?: string | null,"job_type"?: string,"last_error"?: string | null,"locked_at"?: string | null,"locked_by"?: string | null,"max_attempts"?: number,"org_id"?: string,"parent_job_id"?: string | null,"payload"?: NonNullable<Json>,"priority"?: number,"progress"?: number,"progress_message"?: string | null,"queue"?: string,"refund_on_failure"?: boolean,"result"?: Json | null,"run_after"?: string,"started_at"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "jobs_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "jobs_credit_ledger_id_fkey"
      columns: ["credit_ledger_id"]
isOneToOne: false
      referencedRelation: "credit_ledger"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "jobs_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "jobs_parent_job_id_fkey"
      columns: ["parent_job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    }
                  ]
                },"license_activations": {
                  Row: {
                    "activated_at": string,"activated_by": string | null,"created_at": string,"deactivated_at": string | null,"deactivated_by": string | null,"deactivation_kind": string | null,"device_hash": string,"device_label": string | null,"id": string,"last_seen_at": string,"license_id": string | null,"org_id": string,"source": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activated_at"?: string,"activated_by"?: string | null,"created_at"?: string,"deactivated_at"?: string | null,"deactivated_by"?: string | null,"deactivation_kind"?: string | null,"device_hash": string,"device_label"?: string | null,"id"?: string,"last_seen_at"?: string,"license_id"?: string | null,"org_id": string,"source": string,"updated_at"?: string
                  }
                  Update: {
                    "activated_at"?: string,"activated_by"?: string | null,"created_at"?: string,"deactivated_at"?: string | null,"deactivated_by"?: string | null,"deactivation_kind"?: string | null,"device_hash"?: string,"device_label"?: string | null,"id"?: string,"last_seen_at"?: string,"license_id"?: string | null,"org_id"?: string,"source"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "license_activations_license_id_org_id_fkey"
      columns: ["license_id","org_id"]
isOneToOne: false
      referencedRelation: "licenses"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "license_activations_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"license_skus": {
                  Row: {
                    "bonus_credits": number,"code": string,"created_at": string,"fallback_features": NonNullable<Json>,"includes_updates_months": number,"is_active": boolean,"max_activations": number,"max_quantity": number | null,"name": string,"price_krw": number,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bonus_credits"?: number,"code": string,"created_at"?: string,"fallback_features"?: NonNullable<Json>,"includes_updates_months"?: number,"is_active"?: boolean,"max_activations"?: number,"max_quantity"?: number | null,"name": string,"price_krw": number,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "bonus_credits"?: number,"code"?: string,"created_at"?: string,"fallback_features"?: NonNullable<Json>,"includes_updates_months"?: number,"is_active"?: boolean,"max_activations"?: number,"max_quantity"?: number | null,"name"?: string,"price_krw"?: number,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"licenses": {
                  Row: {
                    "created_at": string,"extension_order_ids": (string)[],"id": string,"max_activations": number,"order_id": string | null,"org_id": string,"purchased_at": string,"serial_hash": string,"serial_last5": string,"sku_code": string,"status": string,"status_changed_at": string | null,"status_reason": string | null,"updated_at": string,"updates_until": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"extension_order_ids"?: (string)[],"id"?: string,"max_activations"?: number,"order_id"?: string | null,"org_id": string,"purchased_at"?: string,"serial_hash": string,"serial_last5": string,"sku_code": string,"status"?: string,"status_changed_at"?: string | null,"status_reason"?: string | null,"updated_at"?: string,"updates_until": string
                  }
                  Update: {
                    "created_at"?: string,"extension_order_ids"?: (string)[],"id"?: string,"max_activations"?: number,"order_id"?: string | null,"org_id"?: string,"purchased_at"?: string,"serial_hash"?: string,"serial_last5"?: string,"sku_code"?: string,"status"?: string,"status_changed_at"?: string | null,"status_reason"?: string | null,"updated_at"?: string,"updates_until"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "licenses_order_id_fkey"
      columns: ["order_id"]
isOneToOne: true
      referencedRelation: "payment_orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "licenses_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "licenses_sku_code_fkey"
      columns: ["sku_code"]
isOneToOne: false
      referencedRelation: "license_skus"
      referencedColumns: ["code"]
    }
                  ]
                },"org_members": {
                  Row: {
                    "created_at": string,"invited_by": string | null,"joined_at": string | null,"org_id": string,"role": string,"status": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"invited_by"?: string | null,"joined_at"?: string | null,"org_id": string,"role"?: string,"status"?: string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"invited_by"?: string | null,"joined_at"?: string | null,"org_id"?: string,"role"?: string,"status"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "org_members_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "created_at": string,"deleted_at": string | null,"id": string,"is_personal": boolean,"name": string,"owner_id": string,"settings": NonNullable<Json>,"slug": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: string,"is_personal"?: boolean,"name": string,"owner_id": string,"settings"?: NonNullable<Json>,"slug": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: string,"is_personal"?: boolean,"name"?: string,"owner_id"?: string,"settings"?: NonNullable<Json>,"slug"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"payment_orders": {
                  Row: {
                    "amount_krw": number,"app_id": string,"confirmed_at": string | null,"created_at": string,"created_by": string | null,"credit_pack_id": string | null,"credits": number | null,"currency": string,"customer_key": string | null,"expires_at": string,"id": string,"kind": string,"metadata": NonNullable<Json>,"order_id": string,"org_id": string,"plan_id": string | null,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_krw": number,"app_id": string,"confirmed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"credit_pack_id"?: string | null,"credits"?: number | null,"currency"?: string,"customer_key"?: string | null,"expires_at"?: string,"id"?: string,"kind": string,"metadata"?: NonNullable<Json>,"order_id": string,"org_id": string,"plan_id"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "amount_krw"?: number,"app_id"?: string,"confirmed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"credit_pack_id"?: string | null,"credits"?: number | null,"currency"?: string,"customer_key"?: string | null,"expires_at"?: string,"id"?: string,"kind"?: string,"metadata"?: NonNullable<Json>,"order_id"?: string,"org_id"?: string,"plan_id"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_orders_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_orders_credit_pack_id_fkey"
      columns: ["credit_pack_id"]
isOneToOne: false
      referencedRelation: "credit_packs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_orders_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_orders_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "plans"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount_krw": number,"approved_at": string | null,"canceled_amount_krw": number,"created_at": string,"id": string,"method": string | null,"order_id": string,"org_id": string,"payment_key": string,"raw": NonNullable<Json>,"receipt_url": string | null,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_krw": number,"approved_at"?: string | null,"canceled_amount_krw"?: number,"created_at"?: string,"id"?: string,"method"?: string | null,"order_id": string,"org_id": string,"payment_key": string,"raw"?: NonNullable<Json>,"receipt_url"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "amount_krw"?: number,"approved_at"?: string | null,"canceled_amount_krw"?: number,"created_at"?: string,"id"?: string,"method"?: string | null,"order_id"?: string,"org_id"?: string,"payment_key"?: string,"raw"?: NonNullable<Json>,"receipt_url"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "payment_orders"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "payments_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"plans": {
                  Row: {
                    "app_id": string,"billing_interval": string,"carry_over": boolean,"code": string,"created_at": string,"description": string | null,"features": NonNullable<Json>,"id": string,"is_active": boolean,"is_default": boolean,"monthly_credits": number,"name": string,"price_krw": number,"signup_credits": number,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "app_id": string,"billing_interval"?: string,"carry_over"?: boolean,"code": string,"created_at"?: string,"description"?: string | null,"features"?: NonNullable<Json>,"id"?: string,"is_active"?: boolean,"is_default"?: boolean,"monthly_credits"?: number,"name": string,"price_krw"?: number,"signup_credits"?: number,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "app_id"?: string,"billing_interval"?: string,"carry_over"?: boolean,"code"?: string,"created_at"?: string,"description"?: string | null,"features"?: NonNullable<Json>,"id"?: string,"is_active"?: boolean,"is_default"?: boolean,"monthly_credits"?: number,"name"?: string,"price_krw"?: number,"signup_credits"?: number,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "plans_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"display_name": string,"email": string | null,"id": string,"last_seen_at": string | null,"locale": string,"platform_role": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name"?: string,"email"?: string | null,"id": string,"last_seen_at"?: string | null,"locale"?: string,"platform_role"?: string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name"?: string,"email"?: string | null,"id"?: string,"last_seen_at"?: string | null,"locale"?: string,"platform_role"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"proposals": {
                  Row: {
                    "bytes": number | null,"content_path": string,"content_sha256": string,"created_at": string,"created_by": string | null,"credit_ledger_id": number | null,"credits": number,"doc_kind": string,"error": string | null,"finished_at": string | null,"id": string,"job_id": string | null,"narrative": Json | null,"org_id": string,"pages": number | null,"pdf_path": string | null,"project_ref": string,"render_ids": (string)[],"request_id": string,"sheet_paths": (string)[],"started_at": string | null,"status": string,"template_version": string,"updated_at": string,"variant": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bytes"?: number | null,"content_path": string,"content_sha256": string,"created_at"?: string,"created_by"?: string | null,"credit_ledger_id"?: number | null,"credits": number,"doc_kind": string,"error"?: string | null,"finished_at"?: string | null,"id"?: string,"job_id"?: string | null,"narrative"?: Json | null,"org_id": string,"pages"?: number | null,"pdf_path"?: string | null,"project_ref": string,"render_ids"?: (string)[],"request_id": string,"sheet_paths"?: (string)[],"started_at"?: string | null,"status"?: string,"template_version": string,"updated_at"?: string,"variant": string
                  }
                  Update: {
                    "bytes"?: number | null,"content_path"?: string,"content_sha256"?: string,"created_at"?: string,"created_by"?: string | null,"credit_ledger_id"?: number | null,"credits"?: number,"doc_kind"?: string,"error"?: string | null,"finished_at"?: string | null,"id"?: string,"job_id"?: string | null,"narrative"?: Json | null,"org_id"?: string,"pages"?: number | null,"pdf_path"?: string | null,"project_ref"?: string,"render_ids"?: (string)[],"request_id"?: string,"sheet_paths"?: (string)[],"started_at"?: string | null,"status"?: string,"template_version"?: string,"updated_at"?: string,"variant"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "proposals_credit_ledger_id_fkey"
      columns: ["credit_ledger_id"]
isOneToOne: false
      referencedRelation: "credit_ledger"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "proposals_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "proposals_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"rate_limit_buckets": {
                  Row: {
                    "count": number,"key": string,"updated_at": string,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "count"?: number,"key": string,"updated_at"?: string,"window_start": string
                  }
                  Update: {
                    "count"?: number,"key"?: string,"updated_at"?: string,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"renders": {
                  Row: {
                    "ai_label": boolean,"bytes": number | null,"created_at": string,"created_by": string | null,"credit_ledger_id": number | null,"credits": number,"error": string | null,"expires_at": string | null,"finished_at": string | null,"height": number | null,"id": string,"job_id": string | null,"model": string | null,"options": NonNullable<Json>,"org_id": string,"output_path": string | null,"project_ref": string,"provider": string | null,"purged_at": string | null,"request_id": string,"seed": number | null,"source_render_id": string | null,"started_at": string | null,"status": string,"updated_at": string,"variant": string,"width": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_label"?: boolean,"bytes"?: number | null,"created_at"?: string,"created_by"?: string | null,"credit_ledger_id"?: number | null,"credits": number,"error"?: string | null,"expires_at"?: string | null,"finished_at"?: string | null,"height"?: number | null,"id"?: string,"job_id"?: string | null,"model"?: string | null,"options"?: NonNullable<Json>,"org_id": string,"output_path"?: string | null,"project_ref": string,"provider"?: string | null,"purged_at"?: string | null,"request_id": string,"seed"?: number | null,"source_render_id"?: string | null,"started_at"?: string | null,"status"?: string,"updated_at"?: string,"variant": string,"width"?: number | null
                  }
                  Update: {
                    "ai_label"?: boolean,"bytes"?: number | null,"created_at"?: string,"created_by"?: string | null,"credit_ledger_id"?: number | null,"credits"?: number,"error"?: string | null,"expires_at"?: string | null,"finished_at"?: string | null,"height"?: number | null,"id"?: string,"job_id"?: string | null,"model"?: string | null,"options"?: NonNullable<Json>,"org_id"?: string,"output_path"?: string | null,"project_ref"?: string,"provider"?: string | null,"purged_at"?: string | null,"request_id"?: string,"seed"?: number | null,"source_render_id"?: string | null,"started_at"?: string | null,"status"?: string,"updated_at"?: string,"variant"?: string,"width"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "renders_credit_ledger_id_fkey"
      columns: ["credit_ledger_id"]
isOneToOne: false
      referencedRelation: "credit_ledger"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "renders_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "renders_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "renders_source_render_id_org_id_fkey"
      columns: ["source_render_id","org_id"]
isOneToOne: false
      referencedRelation: "renders"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"reviews": {
                  Row: {
                    "application_date": string,"created_at": string,"created_by": string | null,"credit_ledger_id": number | null,"credits": number,"disclaimer_version": string | null,"error": string | null,"finished_at": string | null,"id": string,"job_id": string | null,"judgment": NonNullable<Json>,"model_summary": NonNullable<Json>,"municipality_code": string,"org_id": string,"project_ref": string,"request_id": string,"result": Json | null,"rule_pack_version": string,"started_at": string | null,"status": string,"updated_at": string,"variant": string
                  }
                  ComputedFields: never
                  Insert: {
                    "application_date": string,"created_at"?: string,"created_by"?: string | null,"credit_ledger_id"?: number | null,"credits": number,"disclaimer_version"?: string | null,"error"?: string | null,"finished_at"?: string | null,"id"?: string,"job_id"?: string | null,"judgment": NonNullable<Json>,"model_summary"?: NonNullable<Json>,"municipality_code": string,"org_id": string,"project_ref": string,"request_id": string,"result"?: Json | null,"rule_pack_version": string,"started_at"?: string | null,"status"?: string,"updated_at"?: string,"variant"?: string
                  }
                  Update: {
                    "application_date"?: string,"created_at"?: string,"created_by"?: string | null,"credit_ledger_id"?: number | null,"credits"?: number,"disclaimer_version"?: string | null,"error"?: string | null,"finished_at"?: string | null,"id"?: string,"job_id"?: string | null,"judgment"?: NonNullable<Json>,"model_summary"?: NonNullable<Json>,"municipality_code"?: string,"org_id"?: string,"project_ref"?: string,"request_id"?: string,"result"?: Json | null,"rule_pack_version"?: string,"started_at"?: string | null,"status"?: string,"updated_at"?: string,"variant"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reviews_credit_ledger_id_fkey"
      columns: ["credit_ledger_id"]
isOneToOne: false
      referencedRelation: "credit_ledger"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reviews_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reviews_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"rule_pack_changes": {
                  Row: {
                    "created_at": string,"effective_from": string,"id": string,"kind": string,"law_ref": string | null,"rule_pack_id": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"effective_from": string,"id"?: string,"kind": string,"law_ref"?: string | null,"rule_pack_id": string,"title": string
                  }
                  Update: {
                    "created_at"?: string,"effective_from"?: string,"id"?: string,"kind"?: string,"law_ref"?: string | null,"rule_pack_id"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "rule_pack_changes_rule_pack_id_fkey"
      columns: ["rule_pack_id"]
isOneToOne: false
      referencedRelation: "rule_packs"
      referencedColumns: ["id"]
    }
                  ]
                },"rule_packs": {
                  Row: {
                    "basis_date": string,"bytes": number,"created_at": string,"id": string,"kid": string,"published_at": string | null,"sha256": string,"signature": string,"status": string,"storage_path": string,"summary": string | null,"updated_at": string,"version": string,"withdrawn_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "basis_date": string,"bytes": number,"created_at"?: string,"id"?: string,"kid": string,"published_at"?: string | null,"sha256": string,"signature": string,"status"?: string,"storage_path": string,"summary"?: string | null,"updated_at"?: string,"version": string,"withdrawn_at"?: string | null
                  }
                  Update: {
                    "basis_date"?: string,"bytes"?: number,"created_at"?: string,"id"?: string,"kid"?: string,"published_at"?: string | null,"sha256"?: string,"signature"?: string,"status"?: string,"storage_path"?: string,"summary"?: string | null,"updated_at"?: string,"version"?: string,"withdrawn_at"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"runtime_config": {
                  Row: {
                    "key": string,"note": string | null,"updated_at": string,"value_int": number
                  }
                  ComputedFields: never
                  Insert: {
                    "key": string,"note"?: string | null,"updated_at"?: string,"value_int": number
                  }
                  Update: {
                    "key"?: string,"note"?: string | null,"updated_at"?: string,"value_int"?: number
                  }
                  Relationships: [
                    
                  ]
                },"site_lookups": {
                  Row: {
                    "created_at": string,"id": number,"lookup_date": string,"org_id": string,"pnu_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: never,"lookup_date": string,"org_id": string,"pnu_hash": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: never,"lookup_date"?: string,"org_id"?: string,"pnu_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "site_lookups_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"subscriptions": {
                  Row: {
                    "app_id": string,"billing_key_id": string | null,"cancel_at_period_end": boolean,"canceled_at": string | null,"created_at": string,"current_period_end": string | null,"current_period_start": string,"failed_charge_count": number,"id": string,"last_credit_grant_key": string | null,"next_charge_at": string | null,"org_id": string,"plan_id": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "app_id": string,"billing_key_id"?: string | null,"cancel_at_period_end"?: boolean,"canceled_at"?: string | null,"created_at"?: string,"current_period_end"?: string | null,"current_period_start"?: string,"failed_charge_count"?: number,"id"?: string,"last_credit_grant_key"?: string | null,"next_charge_at"?: string | null,"org_id": string,"plan_id": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "app_id"?: string,"billing_key_id"?: string | null,"cancel_at_period_end"?: boolean,"canceled_at"?: string | null,"created_at"?: string,"current_period_end"?: string | null,"current_period_start"?: string,"failed_charge_count"?: number,"id"?: string,"last_credit_grant_key"?: string | null,"next_charge_at"?: string | null,"org_id"?: string,"plan_id"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "subscriptions_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "subscriptions_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "subscriptions_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "plans"
      referencedColumns: ["id"]
    }
                  ]
                },"voice_jobs": {
                  Row: {
                    "app_id": string,"characters": number | null,"consent_at": string | null,"consent_kind": string | null,"created_at": string,"credit_ledger_id": number | null,"credits": number,"duration_seconds": number | null,"error": string | null,"expires_at": string | null,"fallback_from": string | null,"feature": string,"id": string,"kind": string,"model": string | null,"notice_version": string | null,"org_id": string,"provider_id": string,"session_id": string | null,"status": string,"storage_path": string | null,"store_audio": boolean,"updated_at": string,"user_id": string | null,"voice_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "app_id": string,"characters"?: number | null,"consent_at"?: string | null,"consent_kind"?: string | null,"created_at"?: string,"credit_ledger_id"?: number | null,"credits"?: number,"duration_seconds"?: number | null,"error"?: string | null,"expires_at"?: string | null,"fallback_from"?: string | null,"feature"?: string,"id"?: string,"kind": string,"model"?: string | null,"notice_version"?: string | null,"org_id": string,"provider_id": string,"session_id"?: string | null,"status"?: string,"storage_path"?: string | null,"store_audio"?: boolean,"updated_at"?: string,"user_id"?: string | null,"voice_id"?: string | null
                  }
                  Update: {
                    "app_id"?: string,"characters"?: number | null,"consent_at"?: string | null,"consent_kind"?: string | null,"created_at"?: string,"credit_ledger_id"?: number | null,"credits"?: number,"duration_seconds"?: number | null,"error"?: string | null,"expires_at"?: string | null,"fallback_from"?: string | null,"feature"?: string,"id"?: string,"kind"?: string,"model"?: string | null,"notice_version"?: string | null,"org_id"?: string,"provider_id"?: string,"session_id"?: string | null,"status"?: string,"storage_path"?: string | null,"store_audio"?: boolean,"updated_at"?: string,"user_id"?: string | null,"voice_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "voice_jobs_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "voice_jobs_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "voice_jobs_provider_id_fkey"
      columns: ["provider_id"]
isOneToOne: false
      referencedRelation: "ai_providers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "voice_jobs_session_id_org_id_fkey"
      columns: ["session_id","org_id"]
isOneToOne: false
      referencedRelation: "voice_sessions"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"voice_sessions": {
                  Row: {
                    "app_id": string,"conversation_id": string | null,"ended_at": string | null,"id": string,"org_id": string,"started_at": string,"status": string,"stt_provider_id": string | null,"total_seconds": number,"tts_provider_id": string | null,"updated_at": string,"user_id": string | null,"visitor_key": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "app_id": string,"conversation_id"?: string | null,"ended_at"?: string | null,"id"?: string,"org_id": string,"started_at"?: string,"status"?: string,"stt_provider_id"?: string | null,"total_seconds"?: number,"tts_provider_id"?: string | null,"updated_at"?: string,"user_id"?: string | null,"visitor_key"?: string | null
                  }
                  Update: {
                    "app_id"?: string,"conversation_id"?: string | null,"ended_at"?: string | null,"id"?: string,"org_id"?: string,"started_at"?: string,"status"?: string,"stt_provider_id"?: string | null,"total_seconds"?: number,"tts_provider_id"?: string | null,"updated_at"?: string,"user_id"?: string | null,"visitor_key"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "voice_sessions_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "voice_sessions_conversation_id_org_id_fkey"
      columns: ["conversation_id","org_id"]
isOneToOne: false
      referencedRelation: "ai_conversations"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "voice_sessions_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "voice_sessions_stt_provider_id_fkey"
      columns: ["stt_provider_id"]
isOneToOne: false
      referencedRelation: "ai_providers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "voice_sessions_tts_provider_id_fkey"
      columns: ["tts_provider_id"]
isOneToOne: false
      referencedRelation: "ai_providers"
      referencedColumns: ["id"]
    }
                  ]
                },"wallets": {
                  Row: {
                    "org_id": string,"pack_balance": number,"plan_balance": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "org_id": string,"pack_balance"?: number,"plan_balance"?: number,"updated_at"?: string
                  }
                  Update: {
                    "org_id"?: string,"pack_balance"?: number,"plan_balance"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "wallets_org_id_fkey"
      columns: ["org_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"webhook_events": {
                  Row: {
                    "attempts": number,"error": string | null,"event_id": string,"event_type": string | null,"id": string,"payload": NonNullable<Json>,"processed_at": string | null,"provider": string,"received_at": string,"signature_valid": boolean,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"error"?: string | null,"event_id": string,"event_type"?: string | null,"id"?: string,"payload": NonNullable<Json>,"processed_at"?: string | null,"provider": string,"received_at"?: string,"signature_valid"?: boolean,"status"?: string
                  }
                  Update: {
                    "attempts"?: number,"error"?: string | null,"event_id"?: string,"event_type"?: string | null,"id"?: string,"payload"?: NonNullable<Json>,"processed_at"?: string | null,"provider"?: string,"received_at"?: string,"signature_valid"?: boolean,"status"?: string
                  }
                  Relationships: [
                    
                  ]
                },"wiki_links": {
                  Row: {
                    "created_at": string,"from_page_id": string,"org_id": string,"to_page_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"from_page_id": string,"org_id": string,"to_page_id": string
                  }
                  Update: {
                    "created_at"?: string,"from_page_id"?: string,"org_id"?: string,"to_page_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "wiki_links_from_page_id_org_id_fkey"
      columns: ["from_page_id","org_id"]
isOneToOne: false
      referencedRelation: "wiki_pages"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "wiki_links_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "wiki_links_to_page_id_org_id_fkey"
      columns: ["to_page_id","org_id"]
isOneToOne: false
      referencedRelation: "wiki_pages"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"wiki_pages": {
                  Row: {
                    "app_id": string,"body_md": string,"collection_id": string | null,"created_at": string,"derived_from_pii": boolean,"id": string,"last_edited_by": string | null,"last_editor": string,"org_id": string,"page_type": string,"slug": string,"source_document_ids": (string)[],"stale_since": string | null,"status": string,"summary": string | null,"title": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "app_id": string,"body_md"?: string,"collection_id"?: string | null,"created_at"?: string,"derived_from_pii"?: boolean,"id"?: string,"last_edited_by"?: string | null,"last_editor"?: string,"org_id": string,"page_type"?: string,"slug": string,"source_document_ids"?: (string)[],"stale_since"?: string | null,"status"?: string,"summary"?: string | null,"title": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "app_id"?: string,"body_md"?: string,"collection_id"?: string | null,"created_at"?: string,"derived_from_pii"?: boolean,"id"?: string,"last_edited_by"?: string | null,"last_editor"?: string,"org_id"?: string,"page_type"?: string,"slug"?: string,"source_document_ids"?: (string)[],"stale_since"?: string | null,"status"?: string,"summary"?: string | null,"title"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "wiki_pages_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "wiki_pages_collection_id_fkey"
      columns: ["collection_id"]
isOneToOne: false
      referencedRelation: "ai_collections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "wiki_pages_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"wiki_revisions": {
                  Row: {
                    "body_md": string,"created_at": string,"edited_by": string | null,"editor_kind": string,"id": number,"org_id": string,"page_id": string,"reason": string | null,"source_document_ids": (string)[],"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "body_md": string,"created_at"?: string,"edited_by"?: string | null,"editor_kind": string,"id"?: never,"org_id": string,"page_id": string,"reason"?: string | null,"source_document_ids"?: (string)[],"version": number
                  }
                  Update: {
                    "body_md"?: string,"created_at"?: string,"edited_by"?: string | null,"editor_kind"?: string,"id"?: never,"org_id"?: string,"page_id"?: string,"reason"?: string | null,"source_document_ids"?: (string)[],"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "wiki_revisions_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "wiki_revisions_page_id_org_id_fkey"
      columns: ["page_id","org_id"]
isOneToOne: false
      referencedRelation: "wiki_pages"
      referencedColumns: ["id","org_id"]
    }
                  ]
                }
          }
          Views: {
            "billing_key_summaries": {
                  Row: {
                    "card_company": string | null,"card_number_masked": string | null,"created_at": string,"customer_key": string,"id": string,"org_id": string,"revoked_at": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                           "card_company"?: string | null,"card_number_masked"?: string | null,"created_at"?: string | null,"customer_key"?: string | null,"id"?: string | null,"org_id"?: string | null,"revoked_at"?: string | null,"status"?: string | null
                         }
                        Update: {
                           "card_company"?: string | null,"card_number_masked"?: string | null,"created_at"?: string | null,"customer_key"?: string | null,"id"?: string | null,"org_id"?: string | null,"revoked_at"?: string | null,"status"?: string | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "billing_keys_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"credit_balances": {
                  Row: {
                    "balance": number | null,"org_id": string,"pack_balance": number,"plan_balance": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                           "balance"?: never,"org_id"?: string | null,"pack_balance"?: number | null,"plan_balance"?: number | null,"updated_at"?: string | null
                         }
                        Update: {
                           "balance"?: never,"org_id"?: string | null,"pack_balance"?: number | null,"plan_balance"?: number | null,"updated_at"?: string | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "wallets_org_id_fkey"
      columns: ["org_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"credit_ledger_reconciliation": {
                  Row: {
                    "drift": number | null,"ledger_balance": number | null,"org_id": string,"wallet_balance": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "wallets_org_id_fkey"
      columns: ["org_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "accept_invite":
{ Args: { "p_org_id": string }; Returns: {
              "created_at": string,
"invited_by": string | null,
"joined_at": string | null,
"org_id": string,
"role": string,
"status": string,
"updated_at": string,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "org_members"
        isOneToOne: true
        isSetofReturn: false
      } },
"activate_license":
{ Args: { "p_device_hash": string,"p_serial_hash": string,"p_user": string }; Returns: Json
                           },
"activate_plan_device":
{ Args: { "p_device_hash": string,"p_org": string,"p_user": string }; Returns: {
              "activated_at": string,
"activated_by": string | null,
"created_at": string,
"deactivated_at": string | null,
"deactivated_by": string | null,
"deactivation_kind": string | null,
"device_hash": string,
"device_label": string | null,
"id": string,
"last_seen_at": string,
"license_id": string | null,
"org_id": string,
"source": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "license_activations"
        isOneToOne: true
        isSetofReturn: false
      } },
"ai_filter_chain":
{ Args: { "p_chain": Json,"p_cross_border_ok": boolean,"p_force": boolean,"p_kind": string }; Returns: Json
                           },
"apply_subscription_transition":
{ Args: { "p_reason"?: string,"p_subscription_id": string,"p_to": string }; Returns: {
              "app_id": string,
"billing_key_id": string | null,
"cancel_at_period_end": boolean,
"canceled_at": string | null,
"created_at": string,
"current_period_end": string | null,
"current_period_start": string,
"failed_charge_count": number,
"id": string,
"last_credit_grant_key": string | null,
"next_charge_at": string | null,
"org_id": string,
"plan_id": string,
"status": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "subscriptions"
        isOneToOne: true
        isSetofReturn: false
      } },
"approve_member":
{ Args: { "p_org_id": string,"p_user_id": string }; Returns: {
              "created_at": string,
"invited_by": string | null,
"joined_at": string | null,
"org_id": string,
"role": string,
"status": string,
"updated_at": string,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "org_members"
        isOneToOne: true
        isSetofReturn: false
      } },
"approve_profile":
{ Args: { "p_user_id": string }; Returns: undefined
                           },
"bootstrap_app_for_org":
{ Args: { "p_app_id": string,"p_org_id"?: string }; Returns: undefined
                           },
"caller_org":
{ Args: { "p_org": string }; Returns: string
                           },
"cancel_job":
{ Args: { "p_job_id": string }; Returns: {
              "app_id": string,
"attempts": number,
"created_at": string,
"created_by": string | null,
"credit_ledger_id": number | null,
"finished_at": string | null,
"heartbeat_at": string | null,
"id": string,
"idempotency_key": string | null,
"job_type": string,
"last_error": string | null,
"locked_at": string | null,
"locked_by": string | null,
"max_attempts": number,
"org_id": string,
"parent_job_id": string | null,
"payload": NonNullable<Json>,
"priority": number,
"progress": number,
"progress_message": string | null,
"queue": string,
"refund_on_failure": boolean,
"result": Json | null,
"run_after": string,
"started_at": string | null,
"status": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "jobs"
        isOneToOne: true
        isSetofReturn: false
      } },
"change_member_role":
{ Args: { "p_org_id": string,"p_role": string,"p_user_id": string }; Returns: {
              "created_at": string,
"invited_by": string | null,
"joined_at": string | null,
"org_id": string,
"role": string,
"status": string,
"updated_at": string,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "org_members"
        isOneToOne: true
        isSetofReturn: false
      } },
"claim_jobs":
{ Args: { "p_job_types"?: (string)[],"p_limit"?: number,"p_queue": string,"p_worker_id": string }; Returns: {
              "app_id": string,
"attempts": number,
"created_at": string,
"created_by": string | null,
"credit_ledger_id": number | null,
"finished_at": string | null,
"heartbeat_at": string | null,
"id": string,
"idempotency_key": string | null,
"job_type": string,
"last_error": string | null,
"locked_at": string | null,
"locked_by": string | null,
"max_attempts": number,
"org_id": string,
"parent_job_id": string | null,
"payload": NonNullable<Json>,
"priority": number,
"progress": number,
"progress_message": string | null,
"queue": string,
"refund_on_failure": boolean,
"result": Json | null,
"run_after": string,
"started_at": string | null,
"status": string,
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "jobs"
        isOneToOne: false
        isSetofReturn: true
      } },
"complete_job":
{ Args: { "p_job_id": string,"p_result"?: Json,"p_worker_id": string }; Returns: {
              "app_id": string,
"attempts": number,
"created_at": string,
"created_by": string | null,
"credit_ledger_id": number | null,
"finished_at": string | null,
"heartbeat_at": string | null,
"id": string,
"idempotency_key": string | null,
"job_type": string,
"last_error": string | null,
"locked_at": string | null,
"locked_by": string | null,
"max_attempts": number,
"org_id": string,
"parent_job_id": string | null,
"payload": NonNullable<Json>,
"priority": number,
"progress": number,
"progress_message": string | null,
"queue": string,
"refund_on_failure": boolean,
"result": Json | null,
"run_after": string,
"started_at": string | null,
"status": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "jobs"
        isOneToOne: true
        isSetofReturn: false
      } },
"config_int":
{ Args: { "p_default": number,"p_key": string }; Returns: number
                           },
"confirm_payment_order":
{ Args: { "p_amount_krw": number,"p_approved_at"?: string,"p_method"?: string,"p_order_id": string,"p_payment_key": string,"p_raw"?: Json }; Returns: {
              "amount_krw": number,
"approved_at": string | null,
"canceled_amount_krw": number,
"created_at": string,
"id": string,
"method": string | null,
"order_id": string,
"org_id": string,
"payment_key": string,
"raw": NonNullable<Json>,
"receipt_url": string | null,
"status": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "payments"
        isOneToOne: true
        isSetofReturn: false
      } },
"consume_credits":
{ Args: { "p_actor_id"?: string,"p_amount": number,"p_app_id": string,"p_idempotency_key"?: string,"p_metadata"?: Json,"p_org_id": string,"p_reason": string,"p_ref_id"?: string,"p_ref_type"?: string }; Returns: {
              "ledger_id": number,"new_balance": number,"pack_used": number,"plan_used": number
            }[]
                           },
"current_org_ids":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"current_org_role":
{ Args: { "org": string }; Returns: string
                           },
"deactivate_activation":
{ Args: { "p_activation_id": string }; Returns: {
              "activated_at": string,
"activated_by": string | null,
"created_at": string,
"deactivated_at": string | null,
"deactivated_by": string | null,
"deactivation_kind": string | null,
"device_hash": string,
"device_label": string | null,
"id": string,
"last_seen_at": string,
"license_id": string | null,
"org_id": string,
"source": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "license_activations"
        isOneToOne: true
        isSetofReturn: false
      } },
"eligible_build":
{ Args: { "p_current": string,"p_org": string,"p_platform": string }; Returns: {
              "build_date": string,
"bytes": number,
"channel": string,
"created_at": string,
"id": string,
"notes": string | null,
"platform": string,
"published_at": string | null,
"sha256": string,
"signature": string,
"status": string,
"storage_path": string,
"updated_at": string,
"version": string
            }
                          SetofOptions: {
        from: "*"
        to: "builds"
        isOneToOne: true
        isSetofReturn: false
      } },
"eligible_rule_packs":
{ Args: { "p_org"?: string }; Returns: {
              "basis_date": string,"bytes": number,"kid": string,"published_at": string,"sha256": string,"signature": string,"status": string,"version": string
            }[]
                           },
"enqueue_job":
{ Args: { "p_app_id": string,"p_created_by"?: string,"p_credit_ledger_id"?: number,"p_idempotency_key"?: string,"p_job_type": string,"p_max_attempts"?: number,"p_org_id": string,"p_parent_job_id"?: string,"p_payload"?: Json,"p_priority"?: number,"p_queue": string,"p_refund_on_failure"?: boolean,"p_run_after"?: string }; Returns: {
              "app_id": string,
"attempts": number,
"created_at": string,
"created_by": string | null,
"credit_ledger_id": number | null,
"finished_at": string | null,
"heartbeat_at": string | null,
"id": string,
"idempotency_key": string | null,
"job_type": string,
"last_error": string | null,
"locked_at": string | null,
"locked_by": string | null,
"max_attempts": number,
"org_id": string,
"parent_job_id": string | null,
"payload": NonNullable<Json>,
"priority": number,
"progress": number,
"progress_message": string | null,
"queue": string,
"refund_on_failure": boolean,
"result": Json | null,
"run_after": string,
"started_at": string | null,
"status": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "jobs"
        isOneToOne: true
        isSetofReturn: false
      } },
"entitled_plan_code":
{ Args: { "app": string,"org": string }; Returns: string
                           },
"expire_stale_payment_orders":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"expire_voice_audio":
{ Args: { "p_limit"?: number }; Returns: {
              "job_id": string,"storage_path": string
            }[]
                           },
"extend_updates":
{ Args: { "p_order_id": string }; Returns: {
              "created_at": string,
"extension_order_ids": (string)[],
"id": string,
"max_activations": number,
"order_id": string | null,
"org_id": string,
"purchased_at": string,
"serial_hash": string,
"serial_last5": string,
"sku_code": string,
"status": string,
"status_changed_at": string | null,
"status_reason": string | null,
"updated_at": string,
"updates_until": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "licenses"
        isOneToOne: false
        isSetofReturn: true
      } },
"fail_ai_run":
{ Args: { "p_reason": string,"p_run_id": string }; Returns: Json
                           },
"fail_job":
{ Args: { "p_error": string,"p_job_id": string,"p_retry_delay_seconds"?: number,"p_retryable"?: boolean,"p_worker_id": string }; Returns: {
              "app_id": string,
"attempts": number,
"created_at": string,
"created_by": string | null,
"credit_ledger_id": number | null,
"finished_at": string | null,
"heartbeat_at": string | null,
"id": string,
"idempotency_key": string | null,
"job_type": string,
"last_error": string | null,
"locked_at": string | null,
"locked_by": string | null,
"max_attempts": number,
"org_id": string,
"parent_job_id": string | null,
"payload": NonNullable<Json>,
"priority": number,
"progress": number,
"progress_message": string | null,
"queue": string,
"refund_on_failure": boolean,
"result": Json | null,
"run_after": string,
"started_at": string | null,
"status": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "jobs"
        isOneToOne: true
        isSetofReturn: false
      } },
"fail_payment_order":
{ Args: { "p_detail"?: Json,"p_order_id": string,"p_reason": string }; Returns: {
              "amount_krw": number,
"app_id": string,
"confirmed_at": string | null,
"created_at": string,
"created_by": string | null,
"credit_pack_id": string | null,
"credits": number | null,
"currency": string,
"customer_key": string | null,
"expires_at": string,
"id": string,
"kind": string,
"metadata": NonNullable<Json>,
"order_id": string,
"org_id": string,
"plan_id": string | null,
"status": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "payment_orders"
        isOneToOne: true
        isSetofReturn: false
      } },
"feature_bool":
{ Args: { "p_default": boolean,"p_features": Json,"p_key": string }; Returns: boolean
                           },
"feature_int":
{ Args: { "p_default": number,"p_features": Json,"p_key": string }; Returns: number
                           },
"finish_ai_run":
{ Args: { "p_result": Json,"p_run_id": string }; Returns: Json
                           },
"grant_credits":
{ Args: { "p_actor_id"?: string,"p_amount": number,"p_app_id": string,"p_bucket"?: string,"p_idempotency_key"?: string,"p_metadata"?: Json,"p_org_id": string,"p_reason": string,"p_ref_id"?: string,"p_ref_type"?: string,"p_reset_plan_bucket"?: boolean }; Returns: {
              "ledger_id": number,"new_balance": number
            }[]
                           },
"has_arch_access":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"has_entitlement":
{ Args: { "app": string,"org": string }; Returns: boolean
                           },
"has_org_role":
{ Args: { "org": string,"roles": (string)[] }; Returns: boolean
                           },
"heartbeat_job":
{ Args: { "p_job_id": string,"p_message"?: string,"p_progress"?: number,"p_worker_id": string }; Returns: boolean
                           },
"invite_member":
{ Args: { "p_org_id": string,"p_role"?: string,"p_user_id": string }; Returns: {
              "created_at": string,
"invited_by": string | null,
"joined_at": string | null,
"org_id": string,
"role": string,
"status": string,
"updated_at": string,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "org_members"
        isOneToOne: true
        isSetofReturn: false
      } },
"is_org_member":
{ Args: { "org": string }; Returns: boolean
                           },
"is_platform_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_privileged_session":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_service_caller":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"issue_license":
{ Args: { "p_order_id": string }; Returns: {
              "license_id": string,"serial": string
            }[]
                           },
"jwt_role":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"kst_today":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"latest_cost_catalog":
{ Args: { "p_org"?: string }; Returns: {
              "basis_date": string,"items": Json,"published_at": string,"sha256": string,"source_note": string,"version": string
            }[]
                           },
"match_ai_chunks":
{ Args: { "p_app_id": string,"p_collection_id"?: string,"p_embedding": string,"p_k"?: number,"p_min_similarity"?: number,"p_org_id": string }; Returns: {
              "chunk_id": number,"collection_id": string,"content": string,"document_id": string,"metadata": Json,"similarity": number
            }[]
                           },
"new_serial_body":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"on_signup_app_bootstrap":
{ Args: { "p_app_id": string,"p_org_id": string,"p_user_id": string }; Returns: undefined
                           },
"org_features":
{ Args: { "p_org": string }; Returns: Json
                           },
"personal_org_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"purge_expired":
{ Args: Record<PropertyKey, never>; Returns: {
              "bucket": string,"path": string
            }[]
                           },
"purge_organization":
{ Args: { "p_org_id": string }; Returns: undefined
                           },
"purge_rate_limit_buckets":
{ Args: { "p_older_than"?: string }; Returns: number
                           },
"purge_wiki_page":
{ Args: { "p_page_id": string,"p_reason": string }; Returns: undefined
                           },
"rate_limit_hit":
{ Args: { "p_key": string,"p_limit": number,"p_window_seconds": number }; Returns: {
              "allowed": boolean,"remaining": number,"reset_at": string
            }[]
                           },
"reap_stale_jobs":
{ Args: { "p_stale_seconds"?: number }; Returns: number
                           },
"reconcile_runs":
{ Args: { "p_org": string }; Returns: number
                           },
"record_site_lookup":
{ Args: { "p_org": string,"p_pnu_hash": string }; Returns: number
                           },
"refund_credits":
{ Args: { "p_actor_id"?: string,"p_amount"?: number,"p_consume_ledger_id": number,"p_idempotency_key"?: string,"p_reason": string }; Returns: {
              "ledger_id": number,"new_balance": number
            }[]
                           },
"remove_member":
{ Args: { "p_org_id": string,"p_user_id": string }; Returns: undefined
                           },
"resolve_ai_route":
{ Args: { "p_app_id": string,"p_feature": string,"p_kind": string,"p_org_id": string }; Returns: Json
                           },
"run_monthly_credit_grants":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"run_subscription_rollover":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"save_cloud_project":
{ Args: { "p_expected_version": number,"p_local_id": string,"p_name": string,"p_storage_path": string }; Returns: {
              "id": string,"version": number
            }[]
                           },
"session_context":
{ Args: { "p_app"?: string,"p_org"?: string }; Returns: Json
                           },
"set_ai_cross_border_ack":
{ Args: { "p_ack": boolean,"p_notice_version"?: string,"p_org_id": string }; Returns: undefined
                           },
"set_ai_routing":
{ Args: { "p_app_id": string,"p_chain"?: Json,"p_feature": string,"p_force_open_source"?: boolean,"p_kind": string,"p_mode": string,"p_org_id": string }; Returns: string
                           },
"start_ai_run":
{ Args: { "p_actor": string,"p_kind": string,"p_options"?: Json,"p_org": string,"p_project_ref": string,"p_request_id": string,"p_variant": string }; Returns: {
              "credits": number,"job_id": string,"run_id": string
            }[]
                           },
"storage_org_id":
{ Args: { "p_name": string }; Returns: string
                           },
"transfer_ownership":
{ Args: { "p_new_owner": string,"p_org_id": string }; Returns: undefined
                           },
"upsert_drafting_profile":
{ Args: { "p": Json,"p_org"?: string }; Returns: {
              "architect_name": string | null,
"contact": string | null,
"created_at": string,
"default_paper": string,
"default_text_height_mm": number,
"font_family": string,
"layer_map": NonNullable<Json>,
"logo_storage_path": string | null,
"office_name": string,
"org_id": string,
"updated_at": string,
"updated_by": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "drafting_profiles"
        isOneToOne: true
        isSetofReturn: false
      } },
"valid_user_path":
{ Args: { "p_org": string,"p_path": string,"p_purpose": string }; Returns: boolean
                           },
"write_audit":
{ Args: { "p_action": string,"p_after"?: Json,"p_before"?: Json,"p_metadata"?: Json,"p_org_id": string,"p_target_id"?: string,"p_target_type"?: string }; Returns: number
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
