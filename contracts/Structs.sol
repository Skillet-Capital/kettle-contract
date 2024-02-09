// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

enum LienStatus {
    CURRENT,
    DELINQUENT,
    DEFAULTED
}

struct LienState {
    uint256 lastPayment;
    uint256 amountOwed;
}

struct Lien {
    address lender;
    address borrower;
    address currency;
    address collection;
    uint256 tokenId;
    uint256 size;
    uint256 principal;
    uint256 rate;
    uint256 period;
    uint256 tenor;
    uint256 startTime;
    uint256 defaultPeriod;
    uint256 defaultRate;
    uint256 fee;
    LienState state;
}

struct LoanOffer {
    address lender;
    address currency;
    address collection;
    uint256 identifier;
    uint256 size;
    uint256 totalAmount;
    uint256 maxAmount;
    uint256 minAmount;
    uint256 tenor;
    uint256 period;
    uint256 rate;
    uint256 fee;
    uint256 defaultPeriod;
    uint256 defaultRate;
}
