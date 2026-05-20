export type ClientType = 'ros_service' | 'ros_topic' | 'ros_action' | 'webrtc' | 'llm' | 'tcp'

export interface ClientEntry {
  id: string
  name: string
  type: ClientType
  config: Record<string, unknown>
  connected: boolean
  is_camera: boolean
  is_active: boolean   // only meaningful for type='llm' — marks the entry that resolves dm.get_client('llm')
  error: string
  last_checked: number
}

export interface SkillDef {
  name: string
  type: 'internal' | 'external'
  description: string
  module_path: string
  func_name: string
  url: string
}

export interface RosScanResult {
  topic: [string, string][]
  service: [string, string][]
  action: [string, string][]
}

export interface AgentEvent {
  event: string
  prompt?: string
  text?: string
  msg?: string
  plan?: string
  step?: number
  total?: number
  task?: string
  result?: Record<string, unknown>
  success?: boolean
  trace?: string
  data?: Record<string, unknown>
  log_image?: string | null
  ts?: number
}
