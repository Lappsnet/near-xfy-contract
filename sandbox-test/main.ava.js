import anyTest from 'ava';
import { Worker, NEAR } from 'near-workspaces';
import { setDefaultResultOrder } from 'dns'; setDefaultResultOrder('ipv4first');

const test = anyTest;

test.beforeEach(async t => {
  const worker = await Worker.init();
  const root = worker.rootAccount;
  const contract = await root.createSubAccount('lending-contract');
  
  await contract.deploy(process.argv[2]);
  await contract.call(contract, 'init', { 
    owner: root.accountId, 
    baseInterestRate: 0.05, 
    minCollateralRatio: 1.5,
    liquidationFee: 0.05
  });
  
  t.context = { worker, root, contract };
});

test.afterEach.always(async t => {
  if (t.context.worker) {
    await t.context.worker.tearDown().catch(error => {
      console.log('Failed to stop the Sandbox:', error);
    });
  }
});

test('deposits funds', async t => {
  const { root, contract } = t.context;
  await root.call(contract, 'deposit', {}, { attachedDeposit: NEAR.parse('1 N').toString() });
  const balance = await contract.view('getDepositBalance', { accountId: root.accountId });
  t.is(balance, NEAR.parse('1 N').toString());
});

test('borrows funds', async t => {
  const { root, contract } = t.context;
  await root.call(contract, 'deposit', {}, { attachedDeposit: NEAR.parse('2 N').toString() });
  await root.call(contract, 'borrow', { amount: NEAR.parse('1 N').toString(), termInDays: 30 }, { attachedDeposit: NEAR.parse('1.5 N').toString() });
  const loanDetails = await contract.view('getLoanDetails', { accountId: root.accountId });
  t.is(loanDetails.amount, NEAR.parse('1 N').toString());
});

test('repays loan', async t => {
  const { root, contract } = t.context;
  await root.call(contract, 'deposit', {}, { attachedDeposit: NEAR.parse('2 N').toString() });
  await root.call(contract, 'borrow', { amount: NEAR.parse('1 N').toString(), termInDays: 30 }, { attachedDeposit: NEAR.parse('1.5 N').toString() });
  await root.call(contract, 'repay', {}, { attachedDeposit: NEAR.parse('1.1 N').toString() });
  const loanDetails = await contract.view('getLoanDetails', { accountId: root.accountId });
  t.is(loanDetails, null);
});

test('withdraws funds', async t => {
  const { root, contract } = t.context;
  await root.call(contract, 'deposit', {}, { attachedDeposit: NEAR.parse('1 N').toString() });
  await root.call(contract, 'withdraw', { amount: NEAR.parse('1 N').toString() });
  const balance = await contract.view('getDepositBalance', { accountId: root.accountId });
  t.is(balance, '0');
});

test('fails to borrow more than available', async t => {
  const { root, contract } = t.context;
  await root.call(contract, 'deposit', {}, { attachedDeposit: NEAR.parse('1 N').toString() });
  await t.throwsAsync(async () => {
    await root.call(contract, 'borrow', { amount: NEAR.parse('2 N').toString(), termInDays: 30 }, { attachedDeposit: NEAR.parse('3 N').toString() });
  }, { instanceOf: Error });
});

test('liquidates undercollateralized loan', async t => {
  const { root, contract } = t.context;
  const borrower = await root.createSubAccount('borrower');
  
  await root.call(contract, 'deposit', {}, { attachedDeposit: NEAR.parse('2 N').toString() });
  await borrower.call(contract, 'borrow', { amount: NEAR.parse('1 N').toString(), termInDays: 30 }, { attachedDeposit: NEAR.parse('1.5 N').toString() });
  
  await root.call(contract, 'updateInterestRates', { baseInterestRate: 0.05, minCollateralRatio: 2, liquidationFee: 0.05 });
  
  await root.call(contract, 'liquidate', { borrower: borrower.accountId });
  
  const loanDetails = await contract.view('getLoanDetails', { accountId: borrower.accountId });
  t.is(loanDetails, null);
  
  const insuranceFundBalance = await contract.view('getInsuranceFundBalance');
  t.true(BigInt(insuranceFundBalance) > BigInt(0));
});

test('fails to liquidate properly collateralized loan', async t => {
  const { root, contract } = t.context;
  const borrower = await root.createSubAccount('borrower');
  
  await root.call(contract, 'deposit', {}, { attachedDeposit: NEAR.parse('2 N').toString() });
  await borrower.call(contract, 'borrow', { amount: NEAR.parse('1 N').toString(), termInDays: 30 }, { attachedDeposit: NEAR.parse('1.5 N').toString() });
  
  await t.throwsAsync(async () => {
    await root.call(contract, 'liquidate', { borrower: borrower.accountId });
  }, { instanceOf: Error });
});

test('calculates correct interest', async t => {
  const { root, contract } = t.context;
  await root.call(contract, 'deposit', {}, { attachedDeposit: NEAR.parse('2 N').toString() });
  await root.call(contract, 'borrow', { amount: NEAR.parse('1 N').toString(), termInDays: 30 }, { attachedDeposit: NEAR.parse('1.5 N').toString() });
  
  const initialLoanDetails = await contract.view('getLoanDetails', { accountId: root.accountId });
  const thirtyDaysLater = BigInt(initialLoanDetails.startTimestamp) + BigInt(30 * 24 * 60 * 60 * 1e9);
  
  const loanDetails = await contract.view('getLoanDetails', { accountId: root.accountId, currentTimestamp: thirtyDaysLater.toString() });
  t.truthy(loanDetails, 'Loan details should exist');
  
  if (loanDetails) {
    t.true(BigInt(loanDetails.amount) > NEAR.parse('1 N'), `Loan amount (${loanDetails.amount}) should be greater than 1 NEAR due to interest`);
  }
});

test('updates interest rates', async t => {
  const { root, contract } = t.context;
  await root.call(contract, 'updateInterestRates', { baseInterestRate: 0.06, minCollateralRatio: 1.6, liquidationFee: 0.06 });
  
  await root.call(contract, 'deposit', {}, { attachedDeposit: NEAR.parse('2 N').toString() });
  await root.call(contract, 'borrow', { amount: NEAR.parse('1 N').toString(), termInDays: 30 }, { attachedDeposit: NEAR.parse('1.6 N').toString() });
  
  const loanDetails = await contract.view('getLoanDetails', { accountId: root.accountId });
  t.truthy(loanDetails, 'Loan details should exist');
  
  if (loanDetails) {
    t.true(loanDetails.interestRate > 0.06, `Interest rate (${loanDetails.interestRate}) should be greater than base rate of 0.06`);
  }
});

test('claims insurance fund successfully', async t => {
  const { root, contract } = t.context;
  const borrower = await root.createSubAccount('borrower');
  
  await root.call(contract, 'deposit', {}, { attachedDeposit: NEAR.parse('2 N').toString() });
  await borrower.call(contract, 'borrow', { amount: NEAR.parse('1 N').toString(), termInDays: 30 }, { attachedDeposit: NEAR.parse('1.5 N').toString() });
  await root.call(contract, 'updateInterestRates', { baseInterestRate: 0.05, minCollateralRatio: 2, liquidationFee: 0.05 });
  await root.call(contract, 'liquidate', { borrower: borrower.accountId });
  
  const initialInsuranceFundBalance = await contract.view('getInsuranceFundBalance');
  t.not(initialInsuranceFundBalance, '0', 'Insurance fund should not be empty before claiming');

  const initialBalance = await root.balance();
  await root.call(contract, 'claimInsuranceFund');
  const finalBalance = await root.balance();
  
  t.true(finalBalance.available > initialBalance.available, 'Contract owner balance should increase after claiming insurance fund');
  
  const finalInsuranceFundBalance = await contract.view('getInsuranceFundBalance');
  t.is(finalInsuranceFundBalance, '0', 'Insurance fund should be empty after claiming');
});