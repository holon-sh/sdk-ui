const member = {
  type: "object",
  properties: { id: { type: "string" }, name: { type: "string" }, role: { enum: ["admin", "member"] } },
  required: ["id", "name", "role"],
  additionalProperties: false,
};
const switches = { type: "object", additionalProperties: { type: "boolean" } };
const settings = {
  type: "object",
  properties: {
    name: { type: "string" },
    visibility: { enum: ["private", "internal", "public"] },
    members: { type: "array", items: member },
    email: switches,
    slack: switches,
  },
  required: ["name", "visibility", "members", "email", "slack"],
  additionalProperties: false,
};
const project = {
  type: "object",
  properties: { name: { type: "string" }, visibility: { enum: ["private", "internal", "public"] } },
  additionalProperties: false,
};
const notification = {
  type: "object",
  properties: { channel: { enum: ["email", "slack"] }, notification: { type: "string" }, on: { type: "boolean" } },
  required: ["channel", "notification", "on"],
  additionalProperties: false,
};
const memberId = { type: "object", properties: { memberId: { type: "string" } }, required: ["memberId"], additionalProperties: false };

export const tools = [
  {
    name: "get_settings",
    description: "Read the project's settings: its name, visibility, members and notification switches.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: settings,
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "save_settings",
    description: "Replace the project's settings with the ones given. Takes effect immediately.",
    inputSchema: settings,
    outputSchema: settings,
    annotations: { destructiveHint: true, openWorldHint: false },
    page: true,
  },
  {
    name: "update_project",
    description: "Change the project's name, its visibility, or both. Takes effect immediately.",
    inputSchema: project,
    outputSchema: { ...project, required: ["name", "visibility"] },
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  {
    name: "set_member_role",
    description: "Make a member of the project an admin or a member. Takes effect immediately.",
    inputSchema: { type: "object", properties: { memberId: { type: "string" }, role: { enum: ["admin", "member"] } }, required: ["memberId", "role"], additionalProperties: false },
    outputSchema: member,
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  {
    name: "remove_member",
    description: "Remove a member from the project. They lose access right away.",
    inputSchema: memberId,
    outputSchema: { type: "object", properties: { removed: member }, required: ["removed"], additionalProperties: false },
    annotations: { destructiveHint: true, openWorldHint: false },
  },
  {
    name: "set_notification",
    description: "Turn one notification on or off for a channel. Takes effect immediately.",
    inputSchema: notification,
    outputSchema: notification,
    annotations: { destructiveHint: false, openWorldHint: false },
  },
];
