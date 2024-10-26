import { NearBindgen, near, call, view, initialize, assert, NearPromise } from 'near-sdk-js';

type AccountId = string;

class Loan {
  borrower: AccountId;
  amount: bigint;
  interestRate: number;
  termInDays: number;
  collateral: bigint;
  startTimestamp: bigint;
  lastInterestCalculation: bigint;

  constructor(borrower: AccountId, amount: bigint, interestRate: number, termInDays: number, collateral: bigint) {
    this.borrower = borrower;
    this.amount = amount;
    this.interestRate = interestRate;
    this.termInDays = termInDays;
    this.collateral = collateral;
    this.startTimestamp = near.blockTimestamp();
    this.lastInterestCalculation = this.startTimestamp;
  }
}

@NearBindgen({ requireInit: true })
class LendingContract {
  owner: AccountId;
  deposits: { [accountId: string]: bigint };
  loans: { [accountId: string]: Loan };
  totalDeposits: bigint;
  totalLoans: bigint;
  baseInterestRate: number;
  minCollateralRatio: number;
  liquidationFee: number;
  insuranceFund: bigint;

  constructor() {
    this.owner = '';
    this.deposits = {};
    this.loans = {};
    this.totalDeposits = BigInt(0);
    this.totalLoans = BigInt(0);
    this.baseInterestRate = 0.05;
    this.minCollateralRatio = 1.5;
    this.liquidationFee = 0.05;
    this.insuranceFund = BigInt(0);
  }

  @initialize({ privateFunction: true })
  init({ owner, baseInterestRate, minCollateralRatio, liquidationFee }: { owner: AccountId, baseInterestRate: number, minCollateralRatio: number, liquidationFee: number }) {
    this.owner = owner;
    this.baseInterestRate = baseInterestRate;
    this.minCollateralRatio = minCollateralRatio;
    this.liquidationFee = liquidationFee;
  }

  @call({ payableFunction: true })
  deposit(): void {
    const amount = BigInt(near.attachedDeposit());
    const accountId = near.predecessorAccountId();
    
    this.deposits[accountId] = (this.deposits[accountId] || BigInt(0)) + amount;
    this.totalDeposits += amount;

    near.log(`Deposited ${amount} NEAR by ${accountId}`);
  }

  @call({ payableFunction: true })
  borrow({ amount, termInDays }: { amount: string, termInDays: number }): NearPromise {
    const accountId = near.predecessorAccountId();
    const borrowAmount = BigInt(amount);
    const collateral = BigInt(near.attachedDeposit());
    
    assert(borrowAmount <= this.totalDeposits - this.totalLoans, "Not enough funds in the contract");
    assert(!this.loans[accountId], "You already have an active loan");
    assert(collateral >= borrowAmount * BigInt(this.minCollateralRatio * 100) / BigInt(100), "Insufficient collateral");

    const interestRate = this.calculateInterestRate(borrowAmount, termInDays);
    this.loans[accountId] = new Loan(accountId, borrowAmount, interestRate, termInDays, collateral);
    this.totalLoans += borrowAmount;

    near.log(`Borrowed ${borrowAmount} NEAR by ${accountId} for ${termInDays} days at ${interestRate}% interest`);
    return NearPromise.new(accountId).transfer(borrowAmount);
  }

  @call({ payableFunction: true })
  repay(): void {
    const accountId = near.predecessorAccountId();
    const repaymentAmount = BigInt(near.attachedDeposit());

    assert(this.loans[accountId], "No active loan found for this borrower");

    const loan = this.loans[accountId];
    this.updateLoanInterest(loan);
    const dueAmount = this.calculateTotalDue(loan);

    assert(repaymentAmount >= dueAmount, "Insufficient repayment amount");

    this.totalLoans -= loan.amount;
    this.totalDeposits += dueAmount;

    // Return excess payment and collateral
    const excessPayment = repaymentAmount - dueAmount;
    const promise = NearPromise.new(accountId);
    promise.transfer(excessPayment + loan.collateral);

    delete this.loans[accountId];

    near.log(`Repaid ${dueAmount} NEAR by ${accountId}`);
  }

  @call({})
  withdraw({ amount }: { amount: string }): NearPromise {
    const accountId = near.predecessorAccountId();
    const withdrawAmount = BigInt(amount);

    assert(this.deposits[accountId], "No deposit found for this account");
    assert(withdrawAmount <= this.deposits[accountId], "Withdrawal amount exceeds deposit balance");
    assert(withdrawAmount <= this.totalDeposits - this.totalLoans, "Not enough funds in the contract");

    this.deposits[accountId] -= withdrawAmount;
    this.totalDeposits -= withdrawAmount;

    near.log(`Withdrawn ${withdrawAmount} NEAR by ${accountId}`);
    return NearPromise.new(accountId).transfer(withdrawAmount);
  }

  @call({})
  liquidate({ borrower }: { borrower: AccountId }): void {
    assert(near.predecessorAccountId() === this.owner, "Only the contract owner can liquidate loans");
    assert(this.loans[borrower], "No active loan found for this borrower");

    const loan = this.loans[borrower];
    this.updateLoanInterest(loan);
    const dueAmount = this.calculateTotalDue(loan);
    const currentCollateralRatio = Number(loan.collateral) / Number(dueAmount);

    assert(currentCollateralRatio < this.minCollateralRatio, "Loan is not eligible for liquidation");

    this.totalLoans -= loan.amount;
    this.totalDeposits += dueAmount;

    const liquidationAmount = loan.collateral;
    const liquidationFeeAmount = liquidationAmount * BigInt(this.liquidationFee * 100) / BigInt(100);
    const remainingCollateral = liquidationAmount - liquidationFeeAmount;

    // Transfer liquidation fee to insurance fund
    this.insuranceFund += liquidationFeeAmount;

    // Transfer remaining collateral to the contract owner
    const promise = NearPromise.new(this.owner);
    promise.transfer(remainingCollateral);

    delete this.loans[borrower];

    near.log(`Liquidated loan for ${borrower}. Liquidation amount: ${liquidationAmount}, Fee: ${liquidationFeeAmount}`);
  }

  @call({})
  claimInsuranceFund(): NearPromise {
    assert(near.predecessorAccountId() === this.owner, "Only the contract owner can claim the insurance fund");
    
    const amount = this.insuranceFund;
    this.insuranceFund = BigInt(0);

    near.log(`Claimed insurance fund: ${amount} NEAR`);
    return NearPromise.new(this.owner).transfer(amount);
  }

  @call({})
  updateInterestRates({ baseInterestRate, minCollateralRatio, liquidationFee }: { baseInterestRate: number, minCollateralRatio: number, liquidationFee: number }): void {
    assert(near.predecessorAccountId() === this.owner, "Only the contract owner can update interest rates");
    
    this.baseInterestRate = baseInterestRate;
    this.minCollateralRatio = minCollateralRatio;
    this.liquidationFee = liquidationFee;

    near.log(`Updated interest rates: Base=${baseInterestRate}, MinCollateral=${minCollateralRatio}, LiquidationFee=${liquidationFee}`);
  }

  @view({})
  getDepositBalance({ accountId }: { accountId: AccountId }): string {
    return (this.deposits[accountId] || BigInt(0)).toString();
  }

  @view({})
  getLoanDetails({ accountId }: { accountId: AccountId }): Loan | null {
    const loan = this.loans[accountId];
    if (loan) {
      this.updateLoanInterest(loan);
    }
    return loan || null;
  }

  @view({})
  getTotalDeposits(): string {
    return this.totalDeposits.toString();
  }

  @view({})
  getTotalLoans(): string {
    return this.totalLoans.toString();
  }

  @view({})
  getInsuranceFundBalance(): string {
    return this.insuranceFund.toString();
  }

  private calculateInterestRate(amount: bigint, termInDays: number): number {
    // Dynamic interest rate calculation based on amount and term
    const amountFactor = Number(amount) / 1e24; // Convert yoctoNEAR to NEAR
    const termFactor = termInDays / 365;
    return this.baseInterestRate + (amountFactor * 0.01) + (termFactor * 0.02);
  }

  private updateLoanInterest(loan: Loan): void {
    const currentTimestamp = near.blockTimestamp();
    const timeElapsed = Number(currentTimestamp - loan.lastInterestCalculation) / 1e9; // Convert nanoseconds to seconds
    const interestAccrued = loan.amount * BigInt(Math.floor(loan.interestRate * timeElapsed / (365 * 24 * 60 * 60) * 100)) / BigInt(100);
    loan.amount += interestAccrued;
    loan.lastInterestCalculation = currentTimestamp;
  }

  private calculateTotalDue(loan: Loan): bigint {
    return loan.amount;
  }
}