// holon-generated-apps-v1 app=checkout
import type { ToolClient, EndpointBinding, CreateOptions } from "holon-ui/runtime";
export { ToolCallError } from "holon-ui/runtime";
export type CheckoutInputOrderId = string;
export type CheckoutOutputTotal = number;
export type OrdersInputOrderId = string;
export type OrdersOutputTotal = number;
export type WithHyphenInputOrderId = string;
export type WithHyphenOutputTotal = number;
export interface Inputs {
  "checkout": {
    "get_order": { "count"?: number; "orderId": CheckoutInputOrderId; };
    "then": {  };
    "toJSON": {  };
    "unknown_output": {  };
  };
  "orders": {
    "get_order": { "count"?: number; "orderId": OrdersInputOrderId; };
    "then": {  };
    "toJSON": {  };
    "unknown_output": {  };
  };
  "with-hyphen": {
    "get_order": { "count"?: number; "orderId": WithHyphenInputOrderId; };
    "then": {  };
    "toJSON": {  };
    "unknown_output": {  };
  };
}
export interface Outputs {
  "checkout": {
    "get_order": { "total": CheckoutOutputTotal; };
  };
  "orders": {
    "get_order": { "total": OrdersOutputTotal; };
  };
  "with-hyphen": {
    "get_order": { "total": WithHyphenOutputTotal; };
  };
}
export interface InputTypes {
  "checkout": {
    "get_order": { "OrderId": CheckoutInputOrderId; };
    "then": {  };
    "toJSON": {  };
    "unknown_output": {  };
  };
  "orders": {
    "get_order": { "OrderId": OrdersInputOrderId; };
    "then": {  };
    "toJSON": {  };
    "unknown_output": {  };
  };
  "with-hyphen": {
    "get_order": { "OrderId": WithHyphenInputOrderId; };
    "then": {  };
    "toJSON": {  };
    "unknown_output": {  };
  };
}
export interface OutputTypes {
  "checkout": {
    "get_order": { "Total": CheckoutOutputTotal; };
  };
  "orders": {
    "get_order": { "Total": OrdersOutputTotal; };
  };
  "with-hyphen": {
    "get_order": { "Total": WithHyphenOutputTotal; };
  };
}
export interface Resources {
  "checkout": {
    "orders://summary": { "total": number; };
  };
  "orders": {
    "orders://summary": { "total": number; };
  };
  "with-hyphen": {
    "orders://summary": { "total": number; };
  };
}
export interface EventArguments {
  "checkout": {
  };
  "orders": {
  };
  "with-hyphen": {
  };
}
export interface EventData {
  "checkout": {
  };
  "orders": {
  };
  "with-hyphen": {
  };
}
export type Events = { readonly [A in keyof EventArguments]: { [K in keyof EventArguments[A]]: { arguments: EventArguments[A][K]; data: K extends keyof EventData[A] ? EventData[A][K] : unknown } } };

export type Apps = { readonly [A in keyof Inputs]: ToolClient<Inputs[A], Outputs[A], Resources[A], Events[A]> };
export declare const connect: import("holon-ui/runtime").Connect<Apps["checkout"]>;
export type { EndpointBinding, CreateOptions };
export declare function createApps<K extends keyof Apps>(bindings: { [A in K]: EndpointBinding }, options?: CreateOptions): Pick<Apps,K>;
