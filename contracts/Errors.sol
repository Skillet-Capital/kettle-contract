// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

error InvalidLien();
error LienDefaulted();
error LienIsCurrent();
error Unauthorized();
error OnlyBorrower();

error InvalidMarketOfferAmount();

error OfferExpired();
error InvalidLoanAmount();
error InsufficientOffer();
error OfferUnavailable();

error InvalidCriteria();

error OfferNotAsk();
error OfferNotBid();

error BidRequiresLoan();
error BidNotWithLoan();
error BidCannotBorrow();
error MakerIsNotBorrower();
error InsufficientAskAmount();

error ItemTypeMismatch();
error CollectionMismatch();
error CurrencyMismatch();
error SizeMismatch();

error InvalidSignature();
error InvalidVParameter();

error RepayOnLastInstallment();
