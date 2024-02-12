// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

enum LienStatus {
    CURRENT,
    DELINQUENT,
    DEFAULTED
}

enum InterestModel {
    FIXED,
    COMPOUND
}

struct LienState {
    uint256 paidThrough;
    uint256 amountOwed;
}

struct Lien {
    address lender;
    address recipient;
    address borrower;
    address currency;
    address collection;
    uint256 tokenId;
    uint256 size;
    uint256 principal;
    uint256 rate;
    uint256 period;
    uint256 tenor;
    uint8 model;
    uint256 startTime;
    uint256 defaultPeriod;
    uint256 defaultRate;
    uint256 fee;
}

struct LoanOffer {
    address lender;
    address recipient;
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
    uint8 model;
    uint256 defaultPeriod;
    uint256 defaultRate;
}
