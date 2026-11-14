import { connect } from "#holon-ui";
import "./styles.css";

const app = await connect();
const { format } = await import("./format.js");
document.querySelector("#total").innerHTML = format((await app.tools.get_order({ orderId: "1" })).total);
