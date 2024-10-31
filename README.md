# NEAR Banking and Asset Tokenization Smart Contract

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

We are revolutionizing banking by tokenizing bank assets, deposit, debt, and investments. We bridge traditional finance with blockchain, offering faster, secure, and transparent financial services.

The NEAR Banking and Asset Tokenization Contract is a smart contract developed using near-CLI for deployment on Near Testnet. It facilitates a secure and efficient banking ecosystem where financial institutions can:

Tokenize Bank Assets: Represent deposits and loans as digital tokens on the blockchain.
Manage Deposits: Accept and track deposits from clients securely.
Issue Loans: Provide loans to clients backed by collateral.
Repay Loans: Handle loan repayments with accrued interest.
Withdraw Assets: Allow clients to withdraw their deposits when not locked in active loans.
Liquidate Undersecured Loans: Maintain the bank's asset integrity by liquidating undercollateralized loans.
Manage Interest Rates and Parameters: Update key financial parameters as the bank's needs evolve.

Features
-Secure Asset Management: Banks can securely manage client deposits and issued loans with individual tracking.
-Collateralized Loans: Clients must provide sufficient collateral to secure their loans, reducing default risk.
-Dynamic Interest Rates: Interest rates are dynamically calculated based on loan amount and term.
-Loan Repayment: Clients can repay their loans along with accrued interest seamlessly.
-Withdrawal Mechanism: Clients can withdraw their funds, provided they are not tied up in active loans.
-Liquidation Process: Authorized personnel can liquidate loans that fall below the required collateral ratio.
-Insurance Fund: A portion of liquidated collateral is allocated to an insurance fund for added security.
-Bank Controls: Authorized bank administrators can update key parameters like interest rates and collateral ratios.

Architecture
The contract comprises two main classes:

Loan: Represents an individual loan with details such as borrower, amount, interest rate, term, collateral, and timestamps.
BankingContract: Manages deposits, loans, total funds, interest rates, collateral ratios, and the insurance fund.
