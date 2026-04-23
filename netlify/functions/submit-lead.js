// Netlify serverless function — proxies form submissions to Odoo CRM via XML-RPC
// Credentials are server-side only — never exposed to the browser

const https = require("https");

const ODOO_URL = "navabrindit-crm.odoo.com";
const ODOO_DB  = "navabrindit-crm";
const ODOO_UID = 2;
const ODOO_KEY = "8872838b4cbc4b6bd3e4ee5c9085232aa4668d4c";

function xmlrpcCall(method, params) {
  return new Promise((resolve, reject) => {
    const body = `<?xml version="1.0"?>
<methodCall>
  <methodName>${method}</methodName>
  <params>${params}</params>
</methodCall>`;

    const options = {
      hostname: ODOO_URL,
      path: "/xmlrpc/2/object",
      method: "POST",
      headers: {
        "Content-Type": "text/xml",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function xmlValue(val) {
  if (typeof val === "string")
    return `<value><string>${val.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</string></value>`;
  if (typeof val === "number") return `<value><int>${val}</int></value>`;
  return `<value><string>${String(val)}</string></value>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { name, email, company, phone, businessType, lookingFor, details, source } = body;

  if (!name || !email || !company) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields: name, email, company" }) };
  }

  const leadSource = source || "UAE ERP Website";
  const interest = lookingFor || "Not specified";
  const bType = businessType || "Not specified";

  const desc = [
    `UAE ERP Enquiry from erp.navabrindsol.com`,
    "",
    `Name: ${name}`,
    `Email: ${email}`,
    `Company: ${company}`,
    phone ? `Phone: ${phone}` : "",
    `Business Type: ${bType}`,
    `Looking For: ${interest}`,
    `Lead Source: ${leadSource}`,
    details ? `\nProject Details:\n${details}` : "",
  ]
    .filter((line) => line !== null && line !== undefined)
    .join("\n")
    .trim();

  const leadTitle = `${interest} — ${company}`;

  const params = `
    <param>${xmlValue(ODOO_DB)}</param>
    <param>${xmlValue(ODOO_UID)}</param>
    <param>${xmlValue(ODOO_KEY)}</param>
    <param>${xmlValue("crm.lead")}</param>
    <param>${xmlValue("create")}</param>
    <param><value><array><data>
      <value><struct>
        <member><name>name</name>${xmlValue(leadTitle)}</member>
        <member><name>contact_name</name>${xmlValue(name)}</member>
        <member><name>email_from</name>${xmlValue(email)}</member>
        <member><name>partner_name</name>${xmlValue(company)}</member>
        <member><name>description</name>${xmlValue(desc)}</member>
        <member><name>type</name>${xmlValue("lead")}</member>
        <member><name>ref</name>${xmlValue(interest)}</member>
        <member><name>tag_ids</name><value><array><data></data></array></value></member>
      </struct></value>
    </data></array></value></param>
    <param><value><struct></struct></value></param>`;

  try {
    const xml = await xmlrpcCall("execute_kw", params);
    const match = xml.match(/<int>(\d+)<\/int>/);
    if (match) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: true, lead_id: parseInt(match[1]) }),
      };
    } else {
      console.error("Unexpected Odoo response:", xml.slice(0, 500));
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Odoo did not return a lead ID" }),
      };
    }
  } catch (err) {
    console.error("Odoo XML-RPC error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to create lead" }),
    };
  }
};
