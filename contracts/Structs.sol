// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

enum LienStatus {
    CURRENT,
    DELINQUENT,
    DEFAULTED
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
    uint256 fee;
    uint256 period;
    uint256 gracePeriod;
    uint256 tenor;
    uint256 startTime;
    LienState state;
}

enum Criteria { SIMPLE, PROOF }

struct LoanOffer {
    address lender;
    address recipient;
    address currency;
    Criteria criteria;
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

struct BorrowOffer {
    address borrower;
    address recipient;
    address currency;
    address collection;
    uint256 tokenId;
    uint256 size;
    uint256 amount;
    uint256 rate;
    uint256 fee;
    uint256 period;
    uint256 gracePeriod;
    uint256 tenor;
}

enum Side { BID, ASK }

struct MarketOffer {
    Side side;
    address maker;
    address currency;
    address collection;
    Criteria criteria;
    uint256 identifier;
    uint256 size;
    uint256 amount;
    bool withLoan;
    uint256 borrowAmount;
}
