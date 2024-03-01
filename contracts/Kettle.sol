// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
// import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import { LoanOffer, BorrowOffer, Lien, LienState, LienStatus, MarketOffer, Side, Criteria } from "./Structs.sol";
import { InvalidLien, LienDefaulted, LienIsCurrent, Unauthorized, MakerIsNotBorrower, InsufficientAskAmount, OnlyBorrower, OfferNotAsk, OfferNotBid, BidNotWithLoan, CollectionMismatch, CurrencyMismatch, SizeMismatch, BidCannotBorrow, BidRequiresLoan, InvalidCriteria } from "./Errors.sol";

import { IKettle } from "./interfaces/IKettle.sol";
import { FixedInterest } from "./models/FixedInterest.sol";
import { Transfer } from "./Transfer.sol";
import { Distributions } from "./Distributions.sol";
import { Signatures } from "./Signatures.sol";

import "hardhat/console.sol";

contract Kettle is IKettle, Signatures {

    uint256 private _nextLienId;
    mapping(uint256 => bytes32) public liens;

    constructor() Signatures() public {}

    function amountOwed(Lien memory lien) public view returns (
        uint256 amountOwed,
        uint256 principal,
        uint256 pastInterest,
        uint256 pastFee,
        uint256 currentInterest,
        uint256 currentFee
    ) {
        (
            amountOwed,
            pastInterest, 
            pastFee, 
            currentInterest,
            currentFee
        ) = FixedInterest.computeAmountOwed(lien);

        principal = lien.state.amountOwed;
    }

    function nextPaymentDate(Lien memory lien) public view returns (uint256 date) {
        return FixedInterest.computeNextPaymentDate(lien);
    }

    function lienStatus(Lien memory lien) public view returns (uint8) {
        return FixedInterest.computeLienStatus(lien);
    }

    /*//////////////////////////////////////////////////
                    BORROW FLOWS
    //////////////////////////////////////////////////*/

    function borrow(
        LoanOffer calldata offer,
        uint256 amount,
        uint256 tokenId,
        address borrower,
        bytes calldata signature,
        bytes32[] calldata proof
    ) public returns (uint256 lienId){
        if (borrower == address(0)) borrower = msg.sender;

        _verifyOfferAuthorization(
            _hashLoanOffer(offer), 
            offer.lender, 
            signature
        );
        
        _verifyCollateral(offer.collateral.criteria, offer.collateral.identifier, tokenId, proof);

        lienId = _borrow(offer, amount, tokenId, borrower);

        Transfer.transferToken(offer.collateral.collection, msg.sender, address(this), tokenId, offer.collateral.size);
        Transfer.transferCurrency(offer.terms.currency, offer.lender, borrower, amount);
    }

    function _borrow(
        LoanOffer calldata offer,
        uint256 amount,
        uint256 tokenId,
        address borrower
    ) internal returns (uint256 lienId) {

        Lien memory lien = Lien(
            offer.lender,
            offer.recipient,
            borrower,
            offer.terms.currency,
            offer.collateral.collection,
            tokenId,
            offer.collateral.size,
            amount,
            offer.terms.rate,
            offer.terms.fee,
            offer.terms.period,
            offer.terms.gracePeriod,
            offer.terms.tenor,
            block.timestamp,
            LienState({
                paidThrough: block.timestamp,
                amountOwed: amount
            })
        );

        unchecked {
            liens[lienId = _nextLienId++] = keccak256(abi.encode(lien));
        }

        // _takeLoanOffer(offer, lien, lienId);

        emit Borrow(
            lienId,
            lien.lender,
            lien.borrower,
            lien.recipient,
            lien.collection,
            lien.currency,
            lien.tokenId,
            lien.size,
            lien.principal,
            lien.rate,
            lien.fee,
            lien.period,
            lien.gracePeriod,
            lien.tenor,
            lien.startTime
        );
    }

    function loan(
        BorrowOffer calldata offer,
        bytes32[] calldata proof
    ) public returns (uint256 lienId) {
        lienId = _loan(offer);

        Transfer.transferToken(offer.collateral.collection, offer.borrower, address(this), offer.collateral.identifier, offer.collateral.size);
        Transfer.transferCurrency(offer.terms.currency, msg.sender, offer.borrower, offer.terms.amount);
    }

    function _loan(
        BorrowOffer calldata offer
    ) internal returns (uint256 lienId) {

        Lien memory lien = Lien(
            msg.sender,
            offer.recipient,
            offer.borrower,
            offer.terms.currency,
            offer.collateral.collection,
            offer.collateral.identifier,
            offer.collateral.size,
            offer.terms.amount,
            offer.terms.rate,
            offer.terms.fee,
            offer.terms.period,
            offer.terms.gracePeriod,
            offer.terms.tenor,
            block.timestamp,
            LienState({
                paidThrough: block.timestamp,
                amountOwed: offer.terms.amount
            })
        );

        unchecked {
            liens[lienId = _nextLienId++] = keccak256(abi.encode(lien));
        }

        // _takeBorrowOffer(offer, lienId);

        emit Borrow(
            lienId,
            lien.lender,
            lien.borrower,
            lien.recipient,
            lien.collection,
            lien.currency,
            lien.tokenId,
            lien.size,
            lien.principal,
            lien.rate,
            lien.fee,
            lien.period,
            lien.gracePeriod,
            lien.tenor,
            lien.startTime
        );
    }

    function principalPayment(
        uint256 lienId,
        uint256 _principal,
        Lien calldata lien
    ) public validateLien(lien, lienId) lienIsCurrent(lien) {
       (
            uint256 pastInterest, 
            uint256 pastFee, 
            uint256 currentInterest, 
            uint256 currentFee,
            uint256 principal
        ) = _payment(lien, lienId, _principal, false);

        Transfer.transferCurrency(lien.currency, msg.sender, lien.lender, pastInterest + currentInterest + principal);
        Transfer.transferCurrency(lien.currency, msg.sender, lien.recipient, pastFee + currentFee);
    }

    function interestPayment(
        uint256 lienId,
        Lien calldata lien
    ) public validateLien(lien, lienId) lienIsCurrent(lien) {
        (
            uint256 pastInterest, 
            uint256 pastFee, 
            uint256 currentInterest,
            uint256 currentFee,
        ) = _payment(lien, lienId, 0, false);

        Transfer.transferCurrency(lien.currency, msg.sender, lien.lender, pastInterest + currentInterest);
        Transfer.transferCurrency(lien.currency, msg.sender, lien.recipient, pastFee + currentFee);
    }

    function curePayment(
        uint256 lienId,
        Lien calldata lien
    ) public validateLien(lien, lienId) lienIsCurrent(lien) {
        (
            uint256 pastInterest, 
            uint256 pastFee,
            ,,
        ) = _payment(lien, lienId, 0, true);

        Transfer.transferCurrency(lien.currency, msg.sender, lien.lender, pastInterest);
        Transfer.transferCurrency(lien.currency, msg.sender, lien.recipient, pastFee);
    }

    function _payment(
        Lien calldata lien,
        uint256 lienId,
        uint256 _principal,
        bool cureOnly
    ) internal returns (
        uint256 pastInterest, 
        uint256 pastFee, 
        uint256 currentInterest,
        uint256 currentFee,
        uint256 principal
    ) {
        (
            ,
            pastInterest, 
            pastFee, 
            currentInterest, 
            currentFee
        ) = FixedInterest.computeAmountOwed(lien);

        // calculate minimum amount to be paid
        uint256 minimumPayment = pastInterest + pastFee;
        if (!cureOnly) {
            minimumPayment += currentInterest + currentFee;
        }

        uint256 principal = Math.min(_principal, lien.state.amountOwed);
        uint256 amountOwed = lien.state.amountOwed - principal;

        // update lien state
        Lien memory newLien = Lien(
            lien.lender,
            lien.recipient,
            lien.borrower,
            lien.currency,
            lien.collection,
            lien.tokenId,
            lien.size,
            lien.principal,
            lien.rate,
            lien.fee,
            lien.period,
            lien.gracePeriod,
            lien.tenor,
            lien.startTime,
            LienState({
                paidThrough: FixedInterest.computePaidThrough(lien, cureOnly),
                amountOwed: amountOwed
            })
        );

        liens[lienId] = keccak256(abi.encode(newLien));

        emit Payment(
            lienId, 
            pastInterest,
            pastFee,
            cureOnly ? 0 : currentInterest,
            cureOnly ? 0 : currentFee,
            principal, 
            newLien.state.amountOwed,
            newLien.state.paidThrough
        );
    }

    function refinance(
        uint256 oldLienId,
        uint256 amount,
        Lien calldata lien,
        LoanOffer calldata offer,
        bytes32[] calldata proof
    ) public 
      validateLien(lien, oldLienId) 
      lienIsCurrent(lien) 
      onlyBorrower(lien )
      returns (uint256 newLienId) 
    {
        newLienId = _borrow(offer, amount, lien.tokenId, msg.sender);

        _verifyCollateral(offer.collateral.criteria, offer.collateral.identifier, lien.tokenId, proof);

        (
            uint256 amountOwed,
            uint256 pastInterest, 
            uint256 pastFee, 
            uint256 currentInterest, 
            uint256 currentFee
        ) = FixedInterest.computeAmountOwed(lien);
        
        Distributions.distributeLoanPayments(
            lien.currency,
            amount,                 // distribute new principal
            amountOwed,
            lien.state.amountOwed,
            pastInterest,
            pastFee,
            currentInterest,
            currentFee,
            lien.lender,            // original lender
            lien.recipient,         // original recipient
            offer.lender,           // primary payer
            msg.sender,             // pays any remaining amount
            msg.sender              // receives net principal
        );

        delete liens[oldLienId];

        emit Refinance(
            oldLienId,
            newLienId,
            amount,
            amountOwed,
            lien.state.amountOwed,
            pastInterest,
            pastFee,
            currentInterest,
            currentFee
        );
    }

    function repay(
        uint256 lienId,
        Lien calldata lien
    ) public validateLien(lien, lienId) lienIsCurrent(lien) {
        (
            uint256 pastInterest,
            uint256 pastFee,
            uint256 currentInterest,
            uint256 currentFee
        ) = _repay(lien, lienId);

        Transfer.transferToken(lien.collection, address(this), lien.borrower, lien.tokenId, lien.size);
        Transfer.transferCurrency(lien.currency, msg.sender, lien.lender, lien.state.amountOwed + pastInterest + currentInterest + pastFee + currentFee);
        Transfer.transferCurrency(lien.currency, msg.sender, lien.recipient, pastFee + currentFee);
    }

    function _repay(
        Lien calldata lien,
        uint256 lienId
    ) internal returns (
        uint256 pastInterest,
        uint256 pastFee,
        uint256 currentInterest,
        uint256 currentFee
    ) {
        uint256 amountOwed;
        (
            amountOwed,
            pastInterest, 
            pastFee, 
            currentInterest, 
            currentFee
        ) = FixedInterest.computeAmountOwed(lien);

        delete liens[lienId];

        emit Repay(
            lienId, 
            pastInterest,
            pastFee,
            currentInterest,
            currentFee,
            lien.state.amountOwed,
            amountOwed
        );
    }

    function claim(
        uint256 lienId,
        Lien calldata lien
    ) public validateLien(lien, lienId) {
        if (!_lienIsDefaulted(lien)) {
            revert LienIsCurrent();
        }

        delete liens[lienId];

        Transfer.transferToken(lien.collection, address(this), lien.lender, lien.tokenId, lien.size);

        emit Claim(lienId, lien.lender);
    }

    /*//////////////////////////////////////////////////
                    MARKETPLACE FLOWS
    //////////////////////////////////////////////////*/

    /**
     * @dev Execute market order
     */
     function marketOrder(
        uint256 tokenId,
        MarketOffer calldata offer,
        bytes calldata signature,
        bytes32[] calldata proof
     ) public {

        _verifyOfferAuthorization(
            _hashMarketOffer(offer), 
            offer.maker, 
            signature
        );

        _verifyCollateral(
            offer.collateral.criteria,
            offer.collateral.identifier, 
            tokenId, 
            proof
        );

        if (offer.side == Side.BID) {
            if (offer.terms.withLoan) {
                revert BidRequiresLoan();
            }
            Transfer.transferToken(offer.collateral.collection, msg.sender, offer.maker, tokenId, offer.collateral.size);
            Transfer.transferCurrency(offer.terms.currency, offer.maker, msg.sender, offer.terms.amount);
            
            emit MarketOrder(
                offer.maker,
                msg.sender,
                offer.terms.currency,
                offer.collateral.collection,
                tokenId,
                offer.collateral.size,
                offer.terms.amount
            );

        } else {
            Transfer.transferToken(offer.collateral.collection, offer.maker, msg.sender, tokenId, offer.collateral.size);
            Transfer.transferCurrency(offer.terms.currency, msg.sender, offer.maker, offer.terms.amount);
            
            emit MarketOrder(
                msg.sender,
                offer.maker,
                offer.terms.currency,
                offer.collateral.collection,
                tokenId,
                offer.collateral.size,
                offer.terms.amount
            );
        }
    }

    /**
     * @dev Purchase an asset with a loan offer
     * @param loanOffer loan offer
     * @param askOffer ask offer
     */
    function buyWithLoan(
        uint256 tokenId,
        uint256 amount,
        LoanOffer calldata loanOffer,
        MarketOffer calldata askOffer,
        bytes32[] calldata loanProof,
        bytes32[] calldata askProof
    ) public returns (uint256 lienId) {

        _verifyCollateral(loanOffer.collateral.criteria, loanOffer.collateral.identifier, tokenId, loanProof);
        _verifyCollateral(askOffer.collateral.criteria, askOffer.collateral.identifier, tokenId, askProof);
        // _takeMarketOffer(askOffer);

        if (askOffer.side != Side.ASK) {
            revert OfferNotAsk();
        }

        if (loanOffer.collateral.collection != askOffer.collateral.collection) {
            revert CollectionMismatch();
        }

        if (loanOffer.terms.currency != askOffer.terms.currency) {
            revert CurrencyMismatch();
        }

        if (loanOffer.collateral.size != askOffer.collateral.size) {
            revert SizeMismatch();
        }

        uint256 _borrowAmount = Math.min(amount, askOffer.terms.amount);

        // start a lien
        lienId = _borrow(loanOffer, _borrowAmount, tokenId, msg.sender);

        // transfer principal to seller
        Transfer.transferCurrency(loanOffer.terms.currency, loanOffer.lender, askOffer.maker, _borrowAmount);

        // transfer rest from buyer to seller
        Transfer.transferCurrency(loanOffer.terms.currency, msg.sender, askOffer.maker, askOffer.terms.amount - _borrowAmount);

        // lock collateral
        Transfer.transferToken(loanOffer.collateral.collection, askOffer.maker, address(this), tokenId, loanOffer.collateral.size);

        emit BuyWithLoan(
            lienId,
            msg.sender,
            askOffer.maker,
            askOffer.terms.currency,
            askOffer.collateral.collection,
            tokenId,
            askOffer.collateral.size,
            askOffer.terms.amount,
            _borrowAmount
        );
    }

    /**
     * @dev Sell an asset into a bid with a loan
     * @param loanOffer loan offer
     * @param bidOffer ask offer
     */
    function sellWithLoan(
        uint256 tokenId,
        LoanOffer calldata loanOffer,
        MarketOffer calldata bidOffer,
        bytes32[] calldata loanProof,
        bytes32[] calldata bidProof
    ) public returns (uint256 lienId) {

        _verifyCollateral(loanOffer.collateral.criteria, loanOffer.collateral.identifier, tokenId, loanProof);
        _verifyCollateral(bidOffer.collateral.criteria, bidOffer.collateral.identifier, tokenId, bidProof);
        // _takeMarketOffer(bidOffer);

        if (bidOffer.side != Side.BID) {
            revert OfferNotBid();
        }

        if (!bidOffer.terms.withLoan) {
            revert BidNotWithLoan();
        }

        if (bidOffer.terms.amount < bidOffer.terms.borrowAmount) {
            revert BidCannotBorrow();
        }

        if (loanOffer.collateral.collection != bidOffer.collateral.collection) {
            revert CollectionMismatch();
        }

        if (loanOffer.terms.currency != bidOffer.terms.currency) {
            revert CurrencyMismatch();
        }

        if (loanOffer.collateral.size != bidOffer.collateral.size) {
            revert SizeMismatch();
        }

        lienId = _borrow(loanOffer, bidOffer.terms.borrowAmount, tokenId, bidOffer.maker);

        // transfer borrow amount to this
        Transfer.transferCurrency(loanOffer.terms.currency, loanOffer.lender, address(this), bidOffer.terms.borrowAmount);

        // transfer rest of bid from buyer to this
        Transfer.transferCurrency(bidOffer.terms.currency, bidOffer.maker, address(this), bidOffer.terms.amount - bidOffer.terms.borrowAmount);

        // transfer all currency to seller
        Transfer.transferCurrency(bidOffer.terms.currency, address(this), msg.sender, bidOffer.terms.amount);

        // lock collateral
        Transfer.transferToken(loanOffer.collateral.collection, msg.sender, address(this), tokenId, bidOffer.collateral.size);

        emit SellWithLoan(
            lienId,
            bidOffer.maker,
            msg.sender,
            bidOffer.terms.currency,
            bidOffer.collateral.collection,
            tokenId,
            bidOffer.collateral.size,
            bidOffer.terms.amount,
            bidOffer.terms.borrowAmount
        );
    }

    /**
     * @dev Purchase an asset in a lien, closes lien, and transfers asset to buyer
     * @param lienId lien identifier
     * @param lien the active lien
     * @param askOffer ask offer
     */
    function buyInLien(
        uint256 lienId,
        Lien calldata lien,
        MarketOffer calldata askOffer,
        bytes calldata askOfferSignature,
        bytes32[] calldata proof
    ) public validateLien(lien, lienId) lienIsCurrent(lien) {

        bytes32 _askOfferHash = _hashMarketOffer(askOffer);
        _verifyOfferAuthorization(
            _askOfferHash,
            askOffer.maker,
            askOfferSignature
        );

        _verifyCollateral(askOffer.collateral.criteria, askOffer.collateral.identifier, lien.tokenId, proof);
        // _takeMarketOffer(askOffer);

        if (lien.borrower != askOffer.maker) {
            revert MakerIsNotBorrower();
        }

        if (askOffer.side != Side.ASK) {
            revert OfferNotAsk();
        }

        if (askOffer.collateral.collection != lien.collection) {
            revert CollectionMismatch();
        }

        if (askOffer.terms.currency != lien.currency) {
            revert CurrencyMismatch();
        }

        if (askOffer.collateral.size != lien.size) {
            revert SizeMismatch();
        }

        (
            uint256 amountOwed,
            uint256 pastInterest, 
            uint256 pastFee, 
            uint256 currentInterest, 
            uint256 currentFee
        ) = FixedInterest.computeAmountOwed(lien);

        // ask amount must be greater than amount owed
        if (askOffer.terms.amount < amountOwed) {
            revert InsufficientAskAmount();
        }

        Distributions.distributeLoanPayments(
            lien.currency, 
            askOffer.terms.amount,      // distribute ask amount
            amountOwed, 
            lien.state.amountOwed, 
            pastInterest, 
            pastFee, 
            currentInterest, 
            currentFee, 
            lien.lender, 
            lien.recipient, 
            msg.sender,                 // buyer pays primary amount
            msg.sender,                 // buyer pays residual amount
            askOffer.maker              // seller receives net principal
        );

        // transfer collateral from this to buyer
        Transfer.transferToken(
            lien.collection, 
            address(this),
            msg.sender, 
            lien.tokenId, 
            lien.size
        );

        delete liens[lienId];

        emit BuyInLien(
            lienId,
            msg.sender,
            lien.borrower,
            askOffer.terms.currency,
            askOffer.collateral.collection,
            lien.tokenId,
            lien.size,
            askOffer.terms.amount,
            amountOwed,
            lien.state.amountOwed,
            pastInterest,
            pastFee,
            currentInterest,
            currentFee
        );
    }

    /**
     * @dev Sell an asset in a lien with a bid
     * @param lienId lien identifier
     * @param lien the active lien
     * @param bidOffer bid offer
     */
    function sellInLien(
        uint256 lienId,
        Lien calldata lien,
        MarketOffer calldata bidOffer,
        bytes calldata bidOfferSignature,
        bytes32[] calldata proof
    ) public validateLien(lien, lienId) lienIsCurrent(lien) onlyBorrower(lien) {

        bytes32 _bidOfferHash = _hashMarketOffer(bidOffer);
        _verifyOfferAuthorization(
            _bidOfferHash,
            bidOffer.maker,
            bidOfferSignature
        );

        _verifyCollateral(bidOffer.collateral.criteria, bidOffer.collateral.identifier, lien.tokenId, proof);
        // _takeMarketOffer(bidOffer);

        if (bidOffer.side != Side.BID) {
            revert OfferNotBid();
        }

        if (bidOffer.collateral.collection != lien.collection) {
            revert CollectionMismatch();
        }

        if (bidOffer.terms.currency != lien.currency) {
            revert CurrencyMismatch();
        }

        if (bidOffer.collateral.size != lien.size) {
            revert SizeMismatch();
        }

        (
            uint256 amountOwed,
            uint256 pastInterest, 
            uint256 pastFee, 
            uint256 currentInterest, 
            uint256 currentFee
        ) = FixedInterest.computeAmountOwed(lien);
        
        Distributions.distributeLoanPayments(
            lien.currency,
            bidOffer.terms.amount,          // distribute bid amount
            amountOwed,
            lien.state.amountOwed,
            pastInterest,
            pastFee,
            currentInterest,
            currentFee,
            lien.lender,
            lien.recipient,
            bidOffer.maker,                 // buyer pays primary amount
            msg.sender,                     // seller pays residual amount
            msg.sender                      // seller receives net principal
        );
        
        // transfer collateral from this to buyer
        Transfer.transferToken(
            lien.collection, 
            address(this),
            bidOffer.maker, 
            lien.tokenId, 
            lien.size
        );

        delete liens[lienId];

        emit SellInLien(
            lienId, 
            bidOffer.maker, 
            lien.borrower, 
            lien.currency, 
            lien.collection, 
            lien.tokenId, 
            lien.size, 
            bidOffer.terms.amount, 
            amountOwed, 
            lien.state.amountOwed, 
            pastInterest, 
            pastFee, 
            currentInterest, 
            currentFee
        );
    }

    function buyInLienWithLoan(
        uint256 lienId,
        uint256 amount,
        Lien calldata lien,
        LoanOffer calldata loanOffer,
        MarketOffer calldata askOffer,
        bytes32[] calldata loanProof,
        bytes32[] calldata askProof
    ) public validateLien(lien, lienId) lienIsCurrent(lien) returns (uint256 newLienId) {

        _verifyCollateral(loanOffer.collateral.criteria, loanOffer.collateral.identifier, lien.tokenId, loanProof);
        _verifyCollateral(askOffer.collateral.criteria, askOffer.collateral.identifier, lien.tokenId, askProof);
        // _takeMarketOffer(askOffer);

        if (askOffer.maker != lien.borrower) {
            revert MakerIsNotBorrower();
        }

        if (askOffer.side != Side.ASK) {
            revert OfferNotAsk();
        }

        if (
            askOffer.collateral.collection != lien.collection 
            || loanOffer.collateral.collection != lien.collection
        ) {
            revert CollectionMismatch();
        }

        if (
            askOffer.terms.currency != lien.currency
            || loanOffer.terms.currency != lien.currency
        ) {
            revert CurrencyMismatch();
        }

        if (
            askOffer.collateral.size != lien.size
            || loanOffer.collateral.size != lien.size
        ) {
            revert SizeMismatch();
        }

        (
            uint256 amountOwed,
            uint256 pastInterest, 
            uint256 pastFee, 
            uint256 currentInterest, 
            uint256 currentFee
        ) = FixedInterest.computeAmountOwed(lien);

        if (askOffer.terms.amount < amountOwed) {
            revert InsufficientAskAmount();
        }

        // start new loan
        uint256 _borrowAmount = Math.min(amount, askOffer.terms.amount);
        newLienId = _borrow(loanOffer, _borrowAmount, lien.tokenId, msg.sender);

        Distributions.distributeLoanPayments(
            lien.currency,
            _borrowAmount,                  // distribute new principal
            amountOwed,
            lien.state.amountOwed,
            pastInterest,
            pastFee,
            currentInterest,
            currentFee,
            lien.lender,
            lien.recipient,
            loanOffer.lender,               // new lender pays primary amount
            msg.sender,                     // buyer pays any remaining amount
            lien.borrower                   // borrower receives net principal
        );

        // remaining amount owed by buyer is the diff between ask and max of borrow or amount owed
        // buyer already pays off lender if borrow amount is less than amount owed
        // if borrow amount is greater than amount owed, then buyer pays rest
        uint256 remainingAmountOwed = askOffer.terms.amount - Math.max(_borrowAmount, amountOwed);

        // transfer rest of amount from buyer to seller (ask must be greater than amount owed)
        Transfer.transferCurrency(
            lien.currency, 
            msg.sender, 
            askOffer.maker, 
            remainingAmountOwed
        );

        delete liens[lienId];

        emit BuyInLienWithLoan(
            lienId,
            newLienId,
            msg.sender,
            lien.borrower,
            askOffer.terms.currency,
            askOffer.collateral.collection,
            lien.tokenId,
            lien.size,
            askOffer.terms.amount,
            _borrowAmount,
            amountOwed,
            lien.state.amountOwed,
            pastInterest,
            pastFee,
            currentInterest,
            currentFee
        );
    }

    function sellInLienWithLoan(
        uint256 lienId,
        Lien calldata lien,
        LoanOffer calldata loanOffer,
        MarketOffer calldata bidOffer,
        bytes32[] calldata loanProof,
        bytes32[] calldata bidProof
    ) public validateLien(lien, lienId) lienIsCurrent(lien) onlyBorrower(lien) returns (uint256 newLienId) {

        _verifyCollateral(loanOffer.collateral.criteria, loanOffer.collateral.identifier, lien.tokenId, loanProof);
        _verifyCollateral(bidOffer.collateral.criteria, bidOffer.collateral.identifier, lien.tokenId, bidProof);
        // _takeMarketOffer(bidOffer);

        if (bidOffer.side != Side.BID) {
            revert OfferNotBid();
        }

        if (!bidOffer.terms.withLoan) {
            revert BidNotWithLoan();
        }

        if (bidOffer.terms.amount < bidOffer.terms.borrowAmount) {
            revert BidCannotBorrow();
        }

        if (
            bidOffer.collateral.collection != lien.collection
            || loanOffer.collateral.collection != lien.collection
        ) {
            revert CollectionMismatch();
        }

        if (
            bidOffer.terms.currency != lien.currency
            || loanOffer.terms.currency != lien.currency
        ) {
            revert CurrencyMismatch();
        }

        if (
            bidOffer.collateral.size != lien.size
            || loanOffer.collateral.size != lien.size
        ) {
            revert SizeMismatch();
        }

        newLienId = _borrow(loanOffer, bidOffer.terms.borrowAmount, lien.tokenId, msg.sender);

        // transfer borrow amount to this
        Transfer.transferCurrency(
            lien.currency, 
            loanOffer.lender, 
            address(this), 
            bidOffer.terms.borrowAmount
        );

        // transfer rest of bid from buyer to this
        Transfer.transferCurrency(
            lien.currency, 
            bidOffer.maker, 
            address(this), 
            bidOffer.terms.amount - bidOffer.terms.borrowAmount
        );

        (
            uint256 amountOwed,
            uint256 pastInterest, 
            uint256 pastFee, 
            uint256 currentInterest, 
            uint256 currentFee
        ) = FixedInterest.computeAmountOwed(lien);

        Distributions.distributeLoanPayments(
            lien.currency,
            bidOffer.terms.amount,      // distribute bid amount
            amountOwed,
            lien.state.amountOwed,
            pastInterest,
            pastFee,
            currentInterest,
            currentFee,
            lien.lender,
            lien.recipient,
            address(this),              // this is the primary payer
            msg.sender,                 // seller pays residual amount
            msg.sender                  // seller receives net principal
        );

        delete liens[lienId];

        emit SellInLienWithLoan(
            lienId, 
            newLienId, 
            bidOffer.maker, 
            lien.borrower, 
            lien.currency, 
            lien.collection, 
            lien.tokenId, 
            lien.size, 
            bidOffer.terms.amount,
            bidOffer.terms.borrowAmount, 
            amountOwed, 
            lien.state.amountOwed, 
            pastInterest, 
            pastFee, 
            currentInterest, 
            currentFee
        );
    }

    modifier validateLien(Lien calldata lien, uint256 lienId) {
        if (!_validateLien(lien, lienId)) {
            revert InvalidLien();
        }

        _;
    }

    modifier lienIsCurrent(Lien calldata lien) {
        if (_lienIsDefaulted(lien)) {
            revert LienDefaulted();
        }

        _;
    }

    modifier onlyBorrower(Lien calldata lien) {
        if (msg.sender != lien.borrower) {
            revert OnlyBorrower();
        }

        _;
    }

    function _validateLien(
        Lien calldata lien,
        uint256 lienId
    ) internal view returns (bool) {
        return liens[lienId] == keccak256(abi.encode(lien));
    }

    function _lienIsDefaulted(
        Lien calldata lien
    ) internal view returns (bool) {
        return (lien.state.paidThrough + lien.period + lien.gracePeriod) < block.timestamp;
    }

    function _verifyCollateral(
        Criteria criteria,
        uint256 identifier,
        uint256 tokenId,
        bytes32[] calldata proof
    ) internal view {
        if (criteria == Criteria.PROOF) {
            if (proof.length == 0 || !MerkleProof.verifyCalldata(proof, bytes32(identifier), keccak256(abi.encode(bytes32(tokenId))))) {
                revert InvalidCriteria();
            }
        } else {
            if (!(tokenId == identifier)) {
                revert InvalidCriteria();
            }
        }
    }
}
