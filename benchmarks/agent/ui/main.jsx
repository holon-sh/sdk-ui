import { Accordion } from "@base-ui/react/accordion";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Button } from "@base-ui/react/button";
import { Field } from "@base-ui/react/field";
import { Menu } from "@base-ui/react/menu";
import { Select } from "@base-ui/react/select";
import { Switch } from "@base-ui/react/switch";
import { Tabs } from "@base-ui/react/tabs";
import { connect } from "holon-ui/runtime";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { channels, visibilities } from "../settings.mjs";
import { tools } from "../tools.mjs";
import { z } from "zod";
import "./styles.css";

const screen = new URLSearchParams(location.search).get("screen");

let draft;
const listeners = new Set();
const subscribe = listener => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const update = patch => {
  draft = { ...draft, ...patch };
  for (const listener of listeners) listener();
};
const member = id => {
  const found = draft.members.find(member => member.id === id);
  if (!found) throw new Error(`No member has the id ${id}.`);
  return found;
};
const setRole = (id, role) => update({ members: draft.members.map(other => (other.id === id ? { ...other, role } : other)) });
const removeMember = id => update({ members: draft.members.filter(other => other.id !== id) });
const setNotification = (channel, notification, on) => update({ [channel]: { ...draft[channel], [notification]: on } });
const save = () => {
  (window.__saved ??= []).push(structuredClone(draft));
  return app.tools.save_settings(draft);
};

const formTools = {
  read_form: {
    description: "Read the settings form as it is on screen now, with any changes not saved yet: the project's name, visibility, members and notification switches.",
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: () => draft,
  },
  edit_project: {
    description: "Change the project's name, its visibility, or both, in the form on screen. Nothing is stored until save_form.",
    inputSchema: z.strictObject({ name: z.string().optional(), visibility: z.enum(["private", "internal", "public"]).optional() }),
    annotations: { destructiveHint: false, openWorldHint: false },
    execute: ({ name = draft.name, visibility = draft.visibility }) => {
      update({ name, visibility });
      return { name, visibility };
    },
  },
  edit_member_role: {
    description: "Make a member of the project an admin or a member, in the form on screen. Nothing is stored until save_form.",
    inputSchema: z.strictObject({ memberId: z.string(), role: z.enum(["admin", "member"]) }),
    annotations: { destructiveHint: false, openWorldHint: false },
    execute: ({ memberId, role }) => {
      setRole(member(memberId).id, role);
      return member(memberId);
    },
  },
  remove_member_from_form: {
    description: "Remove a member from the project, in the form on screen. Nothing is stored until save_form.",
    inputSchema: z.strictObject({ memberId: z.string() }),
    annotations: { destructiveHint: false, openWorldHint: false },
    execute: ({ memberId }) => {
      const removed = member(memberId);
      removeMember(removed.id);
      return { removed };
    },
  },
  edit_notification: {
    description: "Turn one notification on or off for a channel, in the form on screen. Nothing is stored until save_form.",
    inputSchema: z.strictObject({ channel: z.enum(["email", "slack"]), notification: z.string(), on: z.boolean() }),
    annotations: { destructiveHint: false, openWorldHint: false },
    execute: ({ channel, notification, on }) => {
      if (!Object.hasOwn(draft[channel], notification)) throw new Error(`${channel} has no notification named ${notification}. It has: ${Object.keys(draft[channel]).join(", ")}.`);
      setNotification(channel, notification, on);
      return { channel, notification, on };
    },
  },
  save_form: {
    description: "Save the form as it is on screen, the same as pressing Save settings. Every change takes effect at once.",
    annotations: { destructiveHint: true, openWorldHint: false },
    execute: () => save(),
  },
};

const app = await connect(
  {
    identity: { name: "example.com/settings", version: "1" },
    contracts: { settings: { tools: tools.map(({ name, inputSchema, outputSchema }) => ({ name, inputSchema, outputSchema })) } },
    own: "settings",
    endpoint: "/mcp",
  },
  { batch: screen === "holon-batch" || screen === "holon-form-batch", tools: screen?.startsWith("holon-form") ? formTools : {} },
);

function Screen() {
  const settings = React.useSyncExternalStore(subscribe, () => draft);
  const [removing, setRemoving] = React.useState(null);
  const toggleRole = id => setRole(id, member(id).role === "admin" ? "member" : "admin");
  React.useEffect(() => { document.body.dataset.mounted = ""; }, []);

  return (
    <main className="screen">
      <h1>Project settings</h1>
      <Tabs.Root defaultValue="general">
        <Tabs.List className="row" aria-label="Settings">
          <Tabs.Tab value="general">General</Tabs.Tab>
          <Tabs.Tab value="members">Members</Tabs.Tab>
          <Tabs.Tab value="notifications">Notifications</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="general" className="screen">
          <Field.Root className="field">
            <Field.Label>Project name</Field.Label>
            <Field.Control value={settings.name} onValueChange={name => update({ name })} />
          </Field.Root>
          <Select.Root items={visibilities} value={settings.visibility} onValueChange={visibility => update({ visibility })}>
            <div className="field">
              <Select.Label>Visibility</Select.Label>
              <Select.Trigger className="trigger">
                <Select.Value />
              </Select.Trigger>
            </div>
            <Select.Portal>
              <Select.Positioner sideOffset={4} alignItemWithTrigger={false}>
                <Select.Popup className="popup">
                  {visibilities.map(item => (
                    <Select.Item key={item.value} value={item.value} className="item">
                      <Select.ItemText>{item.label}</Select.ItemText>
                    </Select.Item>
                  ))}
                </Select.Popup>
              </Select.Positioner>
            </Select.Portal>
          </Select.Root>
        </Tabs.Panel>

        <Tabs.Panel value="members">
          <ul className="members">
            {settings.members.map(member => (
              <li key={member.id} className="row">
                <span className="name">{member.name}</span>
                <span>{member.role === "admin" ? "Admin" : "Member"}</span>
                <Menu.Root>
                  <Menu.Trigger className="button" aria-label={`Actions for ${member.name}`}>
                    ⋯
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Positioner sideOffset={4}>
                      <Menu.Popup className="popup">
                        <Menu.Item className="item" onClick={() => toggleRole(member.id)}>
                          {member.role === "admin" ? "Make member" : "Make admin"}
                        </Menu.Item>
                        <Menu.Item className="item" onClick={() => setRemoving(member)}>
                          Remove
                        </Menu.Item>
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.Root>
              </li>
            ))}
          </ul>
        </Tabs.Panel>

        <Tabs.Panel value="notifications">
          <Accordion.Root>
            {channels.map(channel => (
              <Accordion.Item key={channel.value} value={channel.value}>
                <Accordion.Header>
                  <Accordion.Trigger className="button">{channel.label}</Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Panel className="screen">
                  {channel.notifications.map(item => (
                    <label key={item.value} className="choice">
                      <Switch.Root
                        className="switch"
                        checked={settings[channel.value][item.value]}
                        onCheckedChange={on => setNotification(channel.value, item.value, on)}
                      >
                        <Switch.Thumb className="switch-thumb" />
                      </Switch.Root>
                      {item.label}
                    </label>
                  ))}
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion.Root>
        </Tabs.Panel>
      </Tabs.Root>

      <AlertDialog.Root open={removing !== null} onOpenChange={open => !open && setRemoving(null)}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="backdrop" />
          <AlertDialog.Popup className="dialog">
            <AlertDialog.Title>Remove {removing?.name}?</AlertDialog.Title>
            <AlertDialog.Description>They lose access to this project right away.</AlertDialog.Description>
            <div className="row">
              <AlertDialog.Close className="button">Cancel</AlertDialog.Close>
              <AlertDialog.Close className="button" onClick={() => removeMember(removing?.id)}>
                Remove
              </AlertDialog.Close>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      <Button className="button" onClick={save}>
        Save settings
      </Button>
    </main>
  );
}

draft = await app.tools.get_settings({});
createRoot(document.getElementById("root")).render(<Screen />);
