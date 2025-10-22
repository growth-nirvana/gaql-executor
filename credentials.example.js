/**
 * Example credentials file for testing
 * Copy this file to credentials.js and fill in your actual values
 * DO NOT COMMIT credentials.js
 */
const developerToken = "YOUR_DEVELOPER_TOKEN";
const clientId = "YOUR_CLIENT_ID";
const clientSecret = "YOUR_CLIENT_SECRET";

const CLIENT_PBJ_JUNIPER_OFFICE = {
  developerToken,
  clientId,
  clientSecret,
  refreshToken: "YOUR_REFRESH_TOKEN",
  customerId: 'YOUR_CUSTOMER_ID',
  loginCustomerId: 'YOUR_LOGIN_CUSTOMER_ID',
};

const CLIENT_UNW_GOOGLE_MAIN_ACCOUNT = {
  developerToken,
  clientId,
  clientSecret,
  refreshToken: "YOUR_REFRESH_TOKEN",
  customerIds: ['YOUR_CUSTOMER_ID_1', 'YOUR_CUSTOMER_ID_2'],
};

// Multi-account example
const CLIENT_UNW_GOOGLE_POSGRADO = {
  developerToken,
  clientId,
  clientSecret,
  refreshToken: "YOUR_REFRESH_TOKEN",
  customerId: 'YOUR_CUSTOMER_ID',
};

const CLIENT_JUICE_SOLIDCORE = {
  developerToken,
  clientId,
  clientSecret,
  refreshToken: "YOUR_REFRESH_TOKEN",
  customerId: 'YOUR_CUSTOMER_ID',
  loginCustomerId: 'YOUR_LOGIN_CUSTOMER_ID',
}

module.exports = {
  CLIENT_PBJ_JUNIPER_OFFICE,
  CLIENT_UNW_GOOGLE_POSGRADO,
  CLIENT_UNW_GOOGLE_MAIN_ACCOUNT,
  CLIENT_JUICE_SOLIDCORE,
};