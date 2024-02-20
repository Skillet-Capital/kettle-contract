// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

enum LienStatus {
    CURRENT,
    DELINQUENT,
    DEFAULTED
}

enum InterestModel {
    FIXED,
    COMPOUND,
    PRO_RATED_FIXED
}

struct LienState {
    uint256 paidThrough;
    uint256 amountOwed;
}

struct LienTerms {
    uint256 principal;
    uint256 rate;
    uint256 fee;
    uint256 period;
    uint256 gracePeriod;
    uint256 tenor;
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
    uint256 fee;
    uint256 period;
    uint256 gracePeriod;
    uint256 tenor;
    uint256 startTime;
    LienState state;
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
    uint256 rate;
    uint256 fee;
    uint256 period;
    uint256 gracePeriod;
    uint256 tenor;
}
