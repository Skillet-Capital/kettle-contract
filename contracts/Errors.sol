// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

error InvalidLien();
error LienDefaulted();
error LienIsCurrent();
error Unauthorized();
error OnlyBorrower();

error OfferNotAsk();
error OfferNotBid();

error BidNotWithLoan();
error BidCannotBorrow();
error MakerIsNotBorrower();
error InsufficientAskAmount();

error CollectionMismatch();
error CurrencyMismatch();
error SizeMismatch();
