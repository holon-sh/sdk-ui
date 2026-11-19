export const visibilities = [
  { value: "private", label: "Private" },
  { value: "internal", label: "Internal" },
  { value: "public", label: "Public" },
];

export const channels = [
  {
    value: "email",
    label: "Email",
    notifications: [
      { value: "deploy-failures", label: "Deploy failures", on: false },
      { value: "weekly-digest", label: "Weekly digest", on: true },
      { value: "mentions", label: "Mentions", on: true },
    ],
  },
  {
    value: "slack",
    label: "Slack",
    notifications: [
      { value: "deploy-failures", label: "Deploy failures", on: true },
      { value: "new-members", label: "New members", on: false },
    ],
  },
];

const names = [
  "Ada Okafor", "Ben Carter", "Chloé Martin", "Daniel Kim", "Elena Rossi", "Farah Haddad", "Gabriel Silva", "Hana Sato",
  "Ivan Petrov", "Julia Novak", "Kofi Mensah", "Lena Fischer", "Mateo García", "Nadia Ali", "Oscar Lindqvist", "Priya Shah",
  "Quinn Murphy", "Rafael Costa", "Sofia Andersson", "Tom Becker", "Uma Iyer", "Victor Dubois", "Wen Li", "Yusuf Demir",
];

const switches = channel => Object.fromEntries(channel.notifications.map(item => [item.value, item.on]));

export function initialSettings() {
  return {
    name: "Apollo",
    visibility: "private",
    members: names.map((name, index) => ({ id: name.toLowerCase().replace(/[^a-z]+/g, "-"), name, role: index === 0 ? "admin" : "member" })),
    email: switches(channels[0]),
    slack: switches(channels[1]),
  };
}
